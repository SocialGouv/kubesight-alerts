import _ from "lodash"
import { LRUCache } from "lru-cache"

import { KubeConfig, Watch, V1ObjectMeta } from "@kubernetes/client-node"
import { getKubeData } from "@/lib/kube"
import {
  CnpgCluster,
  Namespace,
  getBaseBackupStatus,
  getCnpgClusterArchivingStatus,
} from "@/lib/kube/types"
import { logger } from "@/lib/logger"
import { sendNotification } from "@/lib/mattermost"

const allContexts = ["dev", "prod", "ovh-dev", "ovh-prod"]

const watchers: Record<string, Watch> = {}

const alertCache = new LRUCache<string, boolean>({
  max: 2000,
  ttl: 1000 * 60 * 60 * 24, // ms -> 1 day
})

function loadKubeConfigForContext(contextName: string) {
  const kubeConfigForContext = new KubeConfig()
  kubeConfigForContext.loadFromDefault()
  kubeConfigForContext.setCurrentContext(contextName)

  watchers[contextName] = new Watch(kubeConfigForContext)
}

function init() {
  logger.info("starting kubesight-alerts")

  const mainKubeConfig = new KubeConfig()
  mainKubeConfig.loadFromDefault()

  mainKubeConfig
    .getContexts()
    .filter((context) => allContexts.includes(context.name))
    .forEach((context) => {
      loadKubeConfigForContext(context.name)
    })

  if (Object.keys(watchers).length === 0) {
    logger.error("no kube context found")
    process.exit(1)
  }
}

type Cluster = string
type Ns = string
type Kind = string
type Name = string
export const localKubeCache: Record<
  Cluster,
  Record<Ns, Record<Kind, Record<Name, KubeResource>>>
> = {}

type KubeResource = {
  kind?: string
  metadata?: V1ObjectMeta
}
function handleWatchEventForCluster(cluster: string) {
  return function handleWatchEvent<T extends KubeResource>(
    eventType: string,
    resource: T
  ): void {
    if (!resource.kind || !resource.metadata || !resource.metadata.name) {
      logger.error(
        "kube resource missing kind or metadata or name or namespace",
        resource
      )
      return
    }

    if (!(cluster in localKubeCache)) {
      localKubeCache[cluster] = {}
    }

    const ns = resource.metadata?.namespace || "default"
    if (!(ns in localKubeCache[cluster])) {
      localKubeCache[cluster][ns] = {}
    }
    const kind = resource.kind
    if (!(kind in localKubeCache[cluster][ns])) {
      localKubeCache[cluster][ns][kind] = {}
    }

    switch (eventType) {
      case "ADDED":
      case "MODIFIED":
        localKubeCache[cluster][ns][kind][resource.metadata.name] = resource
        break
      case "DELETED":
        delete localKubeCache[cluster][ns][kind][resource.metadata.name]
        break
    }

    debouncedRefreshData()
  }
}

function watch(cluster: string, api: string) {
  // console.log(cluster, "-> watching api", api)
  watchers[cluster].watch(api, {}, handleWatchEventForCluster(cluster), () => {
    watch(cluster, api)
  })
}

export async function startWatchingKube() {
  init()

  const apiPaths = [
    // "/api/v1/events",
    // "/api/v1/pods",
    // "/api/v1/namespaces",
    // "/apis/apps/v1/replicasets",
    // "/apis/apps/v1/deployments",
    // "/apis/batch/v1/cronjobs",
    // "/apis/batch/v1/jobs",
    "/apis/postgresql.cnpg.io/v1/clusters",
  ]

  for (const cluster of Object.keys(watchers)) {
    for (const path of apiPaths) {
      watch(cluster, path)
    }
  }
}

const debouncedRefreshData = _.debounce(refreshData, 1000, {
  maxWait: 1000,
})

async function refreshData() {
  const kubeData = await getKubeData()

  Object.entries(kubeData).forEach(([clusterName, cluster]) => {
    cluster.namespaces.forEach((ns) => {
      checkNamespace(clusterName, ns)
    })
  })
}

async function checkNamespace(clusterName: string, ns: Namespace) {
  ns.cnpgClusters.forEach((cnpgCluster) => {
    checkCnpgCluster(clusterName, ns.name, cnpgCluster)
  })
}

function checkCnpgCluster(
  clusterName: string,
  namespaceName: string,
  cnpgCluster: CnpgCluster
) {
  const baseBackupStatus = getBaseBackupStatus(cnpgCluster)
  const archivingStatus = getCnpgClusterArchivingStatus(cnpgCluster)
  const instancesReady = cnpgCluster.status.readyInstances || 0
  const instancesTotal = cnpgCluster.status.instances
  const instancesStatus = instancesReady === instancesTotal ? "ok" : "error"

  const status = {
    cluster: clusterName,
    ns: namespaceName,
    cnpgCluster: cnpgCluster.metadata.name,
    instancesStatus: instancesStatus,
    instancesReady: instancesReady,
    instancesTotal: instancesTotal,
    baseBackupStatus,
    archivingStatus,
  }
  const statusOk =
    instancesStatus === "ok" &&
    baseBackupStatus === "ok" &&
    archivingStatus === "ok"
  const cacheKey = JSON.stringify(status)
  const alertInCache = alertCache.has(cacheKey)

  const mattermostFields = Object.entries(status).map(([key, value]) => {
    return { title: key, value: String(value) }
  })

  if (statusOk && !alertInCache) {
    return
  } else if (statusOk && alertInCache) {
    logger.info(status, "cnpgCluster alert resolved")
    sendNotification(statusOk, "cnpgCluster alert resolved", mattermostFields)
    alertCache.delete(cacheKey)
  } else if (!statusOk && !alertInCache) {
    logger.error(status, "cnpgCluster alert")
    sendNotification(statusOk, "cnpgCluster alert", mattermostFields)
    alertCache.set(cacheKey, true)
  }

  // otherwise do nothing until alert has expired from cache
}

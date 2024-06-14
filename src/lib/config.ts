import { logger } from "./logger"

export const MATTERMOST_WEBHOOK_URL: string | undefined =
  process.env.MATTERMOST_WEBHOOK_URL
export const MATTERMOST_CHANNEL: string | undefined =
  process.env.MATTERMOST_CHANNEL

if (!MATTERMOST_WEBHOOK_URL) {
  logger.info("MATTERMOST_WEBHOOK_URL not configured")
}

if (MATTERMOST_WEBHOOK_URL && !MATTERMOST_CHANNEL) {
  logger.error(
    "MATTERMOST_WEBHOOK_URL is defined so MATTERMOST_CHANNEL is required"
  )
  process.exit(1)
}

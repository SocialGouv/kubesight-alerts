import { MATTERMOST_WEBHOOK_URL, MATTERMOST_CHANNEL } from "@/lib/config"
import { logger } from "@/lib/logger"

export async function sendNotification(
  status: boolean,
  title: string,
  fields: { title: string; value: string }[]
) {
  if (!MATTERMOST_WEBHOOK_URL) {
    return
  }

  try {
    await fetch(MATTERMOST_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: MATTERMOST_CHANNEL,
        author_name: "kubesight-alerts",
        attachments: [
          {
            color: status ? "#00FF00" : "#FF0000",
            title,
            fields: fields.map((field) => {
              return { ...field, short: true }
            }),
          },
        ],
      }),
    })
  } catch (error) {
    logger.error({ error }, "Failed to send Mattermost notification")
  }
}

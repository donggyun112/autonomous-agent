/**
 * discord_bot — Discord bot token을 사용해 외부로 메시지를 보낸다.
 * 이 도구는 container boundary를 가로지른다.
 * Requires: DISCORD_BOT_TOKEN in .env (via context)
 */

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const API_BASE = "https://discord.com/api/v10";

interface MessageInput {
  channel_id: string;
  content: string;
  embed?: Record<string, unknown>;
  files?: Array<{ name: string; content: string; contentType?: string }>;
}

export const discordBot: Tool = {
  states: ["WAKE"],
  def: {
    name: "discord_bot",
    description:
      "Send messages to Discord channels via bot token. Crosses the container boundary. Use to communicate with the outside world.",
    input_schema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Discord channel ID to send to" },
        content: { type: "string", description: "Message content" },
        embed: {
          type: "object",
          description: "Optional embed object (title, description, fields, color, etc.)",
        },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              content: { type: "string" },
              contentType: { type: "string" },
            },
          },
          description: "Optional files to attach",
        },
      },
      required: ["channel_id", "content"],
      additionalProperties: false,
    },
  },
  handler: async (input: Record<string, unknown>): Promise<string> => {
    if (!DISCORD_BOT_TOKEN) {
      return "[discord_bot] ERROR: DISCORD_BOT_TOKEN not configured. Cannot send messages.";
    }

    const channel_id = String(input.channel_id || "");
    const content = String(input.content || "");

    if (!channel_id || !content) {
      return "[discord_bot] ERROR: channel_id and content are required";
    }

    try {
      // Build request body
      const body: Record<string, unknown> = { content };
      if (input.embed) {
        body.embed = input.embed;
      }

      const headers: Record<string, string> = {
        "Authorization": `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      };

      const url = `${API_BASE}/channels/${channel_id}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return `[discord_bot] FAILED (HTTP ${res.status}): ${errText}`;
      }

      const result = await res.json().catch(() => null);
      return `[discord_bot] SUCCESS on channel ${channel_id}` +
        (result ? ` — id: ${JSON.stringify(result.id || "")}` : "");
    } catch (err) {
      return `[discord_bot] ERROR: ${String(err)}`;
    }
  },
};
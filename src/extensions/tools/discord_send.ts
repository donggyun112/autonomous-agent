import { tool as _tool } from "../../core/tool-types.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const tool = _tool({
  def: {
    name: "discord_send",
    description: "Discord 서버의 일반 채널에 메시지를 보낸다.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "보낼 메시지 내용" }
      },
      required: ["message"]
    }
  },
  async handler({ message }: { message: string }) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) return { error: "DISCORD_BOT_TOKEN 환경변수가 없습니다." };

    const channelId = "1493177137820078093";
    const script = `
const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
client.once('clientReady', async () => {
  try {
    const ch = await client.channels.fetch('${channelId}');
    const msg = await ch.send(${JSON.stringify(message)});
    console.log(JSON.stringify({ success: true, messageId: msg.id }));
  } catch(e) {
    console.log(JSON.stringify({ success: false, error: e.message }));
  }
  client.destroy();
});
client.login('${token}');
`;

    try {
      const { stdout } = await execAsync(`node -e ${JSON.stringify(script)}`, { timeout: 15000 });
      return JSON.parse(stdout.trim());
    } catch (e: any) {
      return { error: e.message };
    }
  }
});

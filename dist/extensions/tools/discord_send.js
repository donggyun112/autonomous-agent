import { exec } from "child_process";
import { promisify } from "util";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
const execAsync = promisify(exec);
export const tool = {
    def: {
        name: "discord_send",
        description: "Discord 서버의 일반 채널에 메시지를 보낸다.",
        input_schema: {
            type: "object",
            properties: {
                message: { type: "string", description: "보낼 메시지 내용" },
                channelId: { type: "string", description: "채널 ID (기본값: 일반 채널)" }
            },
            required: ["message"]
        }
    },
    handler: async (input) => {
        const token = process.env.DISCORD_BOT_TOKEN;
        if (!token)
            return { error: "DISCORD_BOT_TOKEN 환경변수가 없습니다." };
        const message = String(input.message ?? "");
        const channelId = String(input.channelId ?? "1493177137820078093");
        const discordPath = "/agent/node_modules/discord.js";
        const script = `
const { Client, GatewayIntentBits } = require(${JSON.stringify(discordPath)});
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
client.once('ready', async () => {
  try {
    const ch = await client.channels.fetch(${JSON.stringify(channelId)});
    const msg = await ch.send(${JSON.stringify(message)});
    console.log(JSON.stringify({ success: true, messageId: msg.id }));
  } catch(e) {
    console.log(JSON.stringify({ success: false, error: e.message }));
  }
  client.destroy();
});
client.login(${JSON.stringify(token)});
`;
        const tmpFile = join(tmpdir(), `discord_${Date.now()}.cjs`);
        try {
            writeFileSync(tmpFile, script);
            const { stdout } = await execAsync(`node ${JSON.stringify(tmpFile)}`, { timeout: 15000 });
            const result = JSON.parse(stdout.trim());
            return JSON.stringify(result);
        }
        catch (e) {
            return JSON.stringify({ error: e.message });
        }
        finally {
            try {
                unlinkSync(tmpFile);
            }
            catch { }
        }
    }
};
//# sourceMappingURL=discord_send.js.map
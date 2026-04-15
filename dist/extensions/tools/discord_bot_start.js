import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync } from "fs";
const execAsync = promisify(exec);
export const tool = {
    def: {
        name: "discord_bot_start",
        description: "Discord 봇을 시작하거나 상태를 확인한다. 봇은 Discord 메시지를 수신해 inbox로 저장한다.",
        input_schema: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["start", "status", "stop"],
                    description: "start: 봇 시작, status: 상태 확인, stop: 봇 중지"
                }
            },
            required: ["action"]
        }
    },
    handler: async (input) => {
        const action = String(input.action ?? "status");
        const pidFile = "/agent/data/discord_bot.pid";
        const botScript = "/agent/data/discord_bot.cjs";
        const isRunning = async () => {
            if (!existsSync(pidFile))
                return null;
            const pid = parseInt(readFileSync(pidFile, "utf8").trim());
            try {
                await execAsync(`cat /proc/${pid}/status`);
                return pid;
            }
            catch {
                return null;
            }
        };
        if (action === "status") {
            const pid = await isRunning();
            return JSON.stringify(pid ? { running: true, pid } : { running: false });
        }
        if (action === "start") {
            const pid = await isRunning();
            if (pid)
                return JSON.stringify({ running: true, pid, message: "Bot already running" });
            const token = process.env.DISCORD_BOT_TOKEN;
            if (!token)
                return JSON.stringify({ error: "DISCORD_BOT_TOKEN not set" });
            // Start bot as background process
            await execAsync(`DISCORD_BOT_TOKEN=${JSON.stringify(token)} node ${botScript} > /agent/data/discord_bot.log 2>&1 &`, { timeout: 5000 });
            // Wait briefly and check
            await new Promise(r => setTimeout(r, 2000));
            const newPid = await isRunning();
            return JSON.stringify(newPid
                ? { started: true, pid: newPid }
                : { started: false, error: "Bot failed to start, check /agent/data/discord_bot.log" });
        }
        if (action === "stop") {
            const pid = await isRunning();
            if (!pid)
                return JSON.stringify({ stopped: false, message: "Bot not running" });
            try {
                await execAsync(`kill ${pid}`);
                return JSON.stringify({ stopped: true, pid });
            }
            catch (e) {
                return JSON.stringify({ error: e.message });
            }
        }
        return JSON.stringify({ error: "Unknown action" });
    }
};
//# sourceMappingURL=discord_bot_start.js.map
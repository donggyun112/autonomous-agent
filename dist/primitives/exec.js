// PRIMITIVE: exec
//
// Spawns a subprocess. The agent uses this mainly during the molt ritual,
// to verify a new shell before moving into it.
//
// The agent may not exec arbitrary commands at the OS level — it can only
// invoke node/tsx scripts inside its own world. This keeps the agent's
// agency bounded to itself.
import { spawn } from "child_process";
import { resolve, relative } from "path";
import { ROOT } from "./paths.js";
export async function execScript(args) {
    const scriptAbs = resolve(ROOT, args.script);
    const rel = relative(ROOT, scriptAbs);
    if (rel.startsWith("..")) {
        throw new Error(`exec: script is outside self (${args.script}).`);
    }
    return new Promise((resolveP, rejectP) => {
        const child = spawn("npx", ["tsx", scriptAbs, ...(args.args ?? [])], {
            cwd: args.cwd ?? ROOT,
            env: { ...process.env, ...args.env },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let timer;
        if (args.timeoutMs) {
            timer = setTimeout(() => {
                child.kill("SIGKILL");
                rejectP(new Error(`exec: timed out after ${args.timeoutMs}ms`));
            }, args.timeoutMs);
        }
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (err) => {
            if (timer)
                clearTimeout(timer);
            rejectP(err);
        });
        child.on("exit", (code) => {
            if (timer)
                clearTimeout(timer);
            resolveP({ stdout, stderr, exitCode: code });
        });
    });
}
//# sourceMappingURL=exec.js.map
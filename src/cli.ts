// The thin entry point. Process control commands only — this is not the
// agent's UI. Eventually a Discord surface will subscribe to the cycle
// observer and present the agent's life there.
//
//   cli.ts init <name>             — first birth. Creates body files. Refuses if data/ exists.
//   cli.ts cycle                   — run one cycle in the current mode and exit.
//   cli.ts live                    — daemon. Cycles forever; honors agent-requested sleep; performs molt swaps.
//   cli.ts self-test <generationId> — used internally by the molt protocol.

import { existsSync } from "fs";
import { mkdir, readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { createInterface } from "readline/promises";
import { runCycle } from "./core/cycle.js";
import {
  checkInbox as checkInboxApi,
  listPendingQuestions,
  unreadInboxCount,
  userReply,
} from "./core/conversation.js";
import { birth, measureDrift } from "./core/identity.js";
import { cleanupPendingSwapMarker, readPendingSwap, runMockCycleTest, runSelfTest } from "./core/molt.js";
import {
  calculateSleepPressure,
  loadState,
  saveState,
} from "./core/state.js";
import { loginAnthropic } from "./llm/auth/anthropic.js";
import {
  clearAnthropicCredentials,
  credentialsFilePath,
  loadCredentials,
  saveAnthropicCredentials,
} from "./llm/auth/storage.js";
import { resetAuthSource } from "./llm/auth/source.js";
import { memoryStats } from "./primitives/recall.js";
import { DATA, JOURNAL_DIR, LINEAGE, WHO_AM_I } from "./primitives/paths.js";

async function init(args: string[]): Promise<void> {
  const seedName = args[0]?.trim();
  if (!seedName) {
    console.error("usage: cli.ts init <seed_name>");
    console.error("  example: cli.ts init Soren");
    process.exit(2);
  }

  if (existsSync(WHO_AM_I)) {
    console.error("refusing to init: data/whoAmI.md already exists.");
    console.error("the agent has already been born. delete data/ if you want to start over.");
    process.exit(1);
  }

  await mkdir(DATA, { recursive: true });
  await birth(seedName);

  const state = await loadState();
  state.seedName = seedName;
  state.lastTransition = Date.now();
  state.lastTransitionReason = "born";
  await saveState(state);

  console.log(`born. seed name: ${seedName}`);
  console.log(`data/ initialized. run \`pnpm cycle\` to wake for the first time.`);
}

// Minimal observer for the daemon — terse stdout so a `tail -f` is readable.
// Real UI (Discord etc.) will subscribe to the same observer events later.
function minimalObserver() {
  return {
    onTurnStart: (turn: number, mode: string) => {
      process.stdout.write(`\n[turn ${turn} · ${mode}] `);
    },
    onLLMEvent: (event: { type: string }) => {
      if (event.type === "text_delta") process.stdout.write(".");
    },
    onToolStart: (name: string) => {
      process.stdout.write(`\n  → ${name}`);
    },
  };
}

async function cycleOnce(): Promise<void> {
  if (!existsSync(WHO_AM_I)) {
    console.error("not yet born. run `pnpm init <name>` first.");
    process.exit(1);
  }

  const result = await runCycle({ observer: minimalObserver() });
  console.log(
    `\n[cycle] mode=${result.state.mode} turns=${result.turns} tools=${result.toolCalls} reason=${result.reason} cycle#=${result.state.cycle}`,
  );
  console.log(
    `[tokens] in=${result.state.tokensUsed.input} out=${result.state.tokensUsed.output}`,
  );
  if (result.state.wakeAfter) {
    const minutes = Math.round((result.state.wakeAfter - Date.now()) / 60000);
    console.log(`[sleep] requested wake in ~${minutes} minutes`);
  }
}

async function statusCmd(): Promise<void> {
  if (!existsSync(WHO_AM_I)) {
    console.log("(not yet born)");
    return;
  }

  const state = await loadState();
  const pressure = calculateSleepPressure(state);

  console.log("── autonomous-agent status ──");
  console.log(`name (seed):      ${state.seedName || "(unknown)"}`);
  console.log(`mode:             ${state.mode}`);
  console.log(`cycle:            ${state.cycle}`);
  console.log(`sleep_count:      ${state.sleepCount}`);
  console.log(
    `awake for:        ${(state.awakeMs / 3600000).toFixed(2)}h`,
  );
  console.log(
    `sleep pressure:   ${pressure.combined.toFixed(2)} (${pressure.level}) · homeostatic=${pressure.homeostatic.toFixed(2)} circadian=${pressure.circadian.toFixed(2)}`,
  );
  console.log(
    `tokens used:      in=${state.tokensUsed.input} out=${state.tokensUsed.output}`,
  );
  console.log(`last transition:  ${state.lastTransitionReason}`);

  if (state.wakeAfter) {
    const ms = state.wakeAfter - Date.now();
    if (ms > 0) {
      console.log(`scheduled wake:   in ~${Math.round(ms / 60000)}m`);
    }
  }

  // Drift
  try {
    const drift = await measureDrift("previous");
    if (drift) {
      console.log(
        `drift vs prior:   ${drift.score.toFixed(3)} (${drift.level}, ${drift.comparedAgainstAge})`,
      );
    }
  } catch {
    // ok
  }

  // Memory stats
  try {
    const stats = await memoryStats();
    console.log(
      `memory:           ${stats.activeMemoryCount} memories · ${stats.keyCount} keys · ${stats.linkCount} links · avg depth ${stats.avgDepth.toFixed(2)}`,
    );
  } catch {
    console.log(`memory:           (not loaded)`);
  }

  // Last journal line
  try {
    const files = (await readdir(JOURNAL_DIR)).filter((f) => f.endsWith(".md")).sort();
    if (files.length > 0) {
      const last = files[files.length - 1];
      const text = await readFile(join(JOURNAL_DIR, last), "utf-8");
      const trimmed = text.trim();
      const lastBlock = trimmed.split(/\n## /).pop() ?? "";
      const preview = lastBlock.split("\n").slice(0, 4).join("\n");
      console.log(`\nlast journal (${last}):\n${preview}`);
    }
  } catch {
    // ok
  }

  // Pending molt
  const pending = await readPendingSwap();
  if (pending) {
    console.log(
      `\n[molt pending] ${pending.generationId} — ${pending.reason}`,
    );
  }

  // Pending conversation
  const pendingQ = await listPendingQuestions();
  const unread = await unreadInboxCount();
  if (pendingQ.length > 0 || unread > 0) {
    console.log(
      `\nconversation:     ${pendingQ.length} pending question(s) from agent, ${unread} unread reply/message from user`,
    );
    console.log(`  list questions: pnpm inbox`);
    console.log(`  reply:          pnpm reply <id> <message>`);
  }

  // Lineage
  try {
    await stat(LINEAGE);
    const text = await readFile(LINEAGE, "utf-8");
    const lines = text.trim().split("\n").slice(-3);
    console.log(`\nlineage (last 3):\n${lines.join("\n")}`);
  } catch {
    // ok
  }
}

async function loginCmd(): Promise<void> {
  console.log("── anthropic OAuth login ──");
  console.log("A browser window will open for you to log in with your Claude account.");
  console.log("After authorizing, you will be redirected to a page with an authorization code.");
  console.log("Copy the full URL (or just the code) and paste it back here.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const credentials = await loginAnthropic({
      onAuthUrl: (url) => {
        console.log("Open this URL in your browser:\n");
        console.log(url);
        console.log("");
      },
      onPromptCode: async () => {
        return await rl.question("Paste the code or URL here: ");
      },
    });

    await saveAnthropicCredentials(credentials);
    resetAuthSource();
    console.log(`\nlogin complete. credentials saved to ${credentialsFilePath()}`);
    console.log(`token expires around ${new Date(credentials.expires).toISOString()} (auto-refreshed)`);
  } finally {
    rl.close();
  }
}

async function logoutCmd(): Promise<void> {
  await clearAnthropicCredentials();
  resetAuthSource();
  console.log("logged out. Anthropic OAuth credentials removed.");
}

async function whoamiCmd(): Promise<void> {
  const creds = await loadCredentials();
  if (creds.anthropic) {
    console.log(`auth: Anthropic OAuth (expires ${new Date(creds.anthropic.expires).toISOString()})`);
    console.log(`file: ${credentialsFilePath()}`);
  } else if (process.env.ANTHROPIC_API_KEY) {
    console.log("auth: $ANTHROPIC_API_KEY (environment)");
  } else {
    console.log("auth: (none) — run `pnpm login` or set ANTHROPIC_API_KEY");
  }
}

async function inboxCmd(): Promise<void> {
  // Show both: pending questions the agent asked us, and letters it wrote.
  const pending = await listPendingQuestions();
  if (pending.length === 0) {
    console.log("(no pending questions)");
  } else {
    console.log(`── ${pending.length} pending question(s) from the agent ──\n`);
    for (const q of pending) {
      console.log(`[${q.id}] asked ${q.askedAt}`);
      console.log(`  reason: ${q.reason}`);
      console.log(`  file:   ${q.file}`);
      try {
        const text = await readFile(q.file, "utf-8");
        const body = text.replace(/^---[\s\S]*?---\n/, "").trim();
        console.log(`\n${body}\n`);
      } catch {
        // ok
      }
      console.log("─────────────────────────────\n");
    }
    console.log("reply with: pnpm reply <id> <message>");
  }
}

async function replyCmd(args: string[]): Promise<void> {
  const id = args[0];
  const text = args.slice(1).join(" ").trim();
  if (!id || !text) {
    console.error("usage: cli.ts reply <id> <message>");
    console.error("       cli.ts reply new <message>    (unprompted message to agent)");
    process.exit(2);
  }
  const result = await userReply({
    inReplyTo: id === "new" ? undefined : id,
    text,
  });
  console.log(`reply written: ${result.file}`);
  console.log("the agent will see this next time it calls check_inbox");
}

async function selfTest(args: string[]): Promise<void> {
  const generationId = args[0];
  if (!generationId) {
    console.error("usage: cli.ts self-test <generationId>");
    process.exit(2);
  }
  await runSelfTest(generationId);
  console.log(`[self-test] ${generationId} ok`);
}

// After a molt, the compose restart policy brings up a fresh container from
// the newly-tagged :current image. When we boot here, we might find a
// swap-pending marker left over from the previous container's exit. That's
// informational — the actual image retag already happened. Just clean it up.
async function maybeCleanupSwapMarker(): Promise<void> {
  const pending = await readPendingSwap();
  if (pending) {
    console.log(
      `[molt] previous generation completed: ${pending.generationId} (${pending.imageTag})`,
    );
    await cleanupPendingSwapMarker();
  }
}

async function live(): Promise<void> {
  if (!existsSync(WHO_AM_I)) {
    console.error("not yet born. run `pnpm init <name>` first.");
    process.exit(1);
  }

  console.log("[live] daemon starting. Ctrl+C to stop. Exit 75 = molt swap requested.");

  // At startup, clean up any stale swap-pending marker from a previous
  // container exit. The actual image retag already happened; this is just
  // a stale file.
  await maybeCleanupSwapMarker();

  let running = true;
  process.on("SIGINT", () => {
    console.log("\n[live] stopping after current cycle…");
    running = false;
  });

  while (running) {
    const state = await loadState();

    // Honor scheduled wake.
    if (state.wakeAfter && Date.now() < state.wakeAfter) {
      const waitMs = state.wakeAfter - Date.now();
      const sleepFor = Math.min(waitMs, 60_000); // wake every minute to check
      await sleep(sleepFor);
      continue;
    }

    // If the agent is in SLEEP and a wake time has passed, DO NOT flip to
    // WAKE directly — that would skip runSleepConsolidation(). Instead,
    // leave mode=SLEEP and let runCycle() hit the SLEEP branch, which runs
    // consolidation (dream, prune, wiki, whoAmI integrate, etc.) and THEN
    // transitions to WAKE with awakeMs reset. The wakeAfter field is only
    // cleared after consolidation runs. (P1-1 fix: GPT-5.4 review)
    if (state.mode === "SLEEP" && state.wakeAfter && Date.now() >= state.wakeAfter) {
      // Clear wakeAfter so the daemon doesn't keep looping without acting,
      // but keep mode=SLEEP so consolidation fires.
      state.wakeAfter = 0;
      await saveState(state);
      // runCycle() will see mode=SLEEP → run consolidation → transition WAKE.
    }

    try {
      const result = await runCycle({ observer: minimalObserver() });
      console.log(
        `\n[live] mode=${result.state.mode} turns=${result.turns} tools=${result.toolCalls} reason=${result.reason}`,
      );

      // P1-5 fix + round-5 P1: after every cycle, check if a molt swap
      // was queued. If so, we must stop the current container AND recreate
      // it (not just restart) because Docker restart policies reuse the
      // same container object pinned to its original image ID. `docker
      // compose up` recreates, but `restart: unless-stopped` does not.
      //
      // To handle this correctly we exec `docker compose up -d` from
      // inside the container (docker.sock is mounted) which recreates
      // the service from the newly-tagged :current image, then exit.
      // If docker compose isn't available (host mode), fall back to
      // exit 75 and hope the wrapper recreates.
      const swapPending = await readPendingSwap();
      if (swapPending) {
        console.log(
          `\n[molt] swap pending: ${swapPending.generationId} — ${swapPending.reason}`,
        );
        try {
          // Try compose recreate first (works inside Docker deployment).
          const { spawnSync } = await import("child_process");
          const composeResult = spawnSync(
            "docker",
            ["compose", "up", "-d", "--force-recreate", "agent"],
            { stdio: "inherit", timeout: 30_000 },
          );
          if (composeResult.status === 0) {
            console.log("[molt] compose recreated with new image. exiting old container.");
            process.exit(0);
          }
        } catch {
          // docker compose not available — fall back to exit 75
        }
        console.log("[molt] exiting 75 for wrapper restart into new image…");
        process.exit(75);
      }
    } catch (err) {
      console.error(`[live] cycle error: ${(err as Error).message}`);
      // Sleep a bit before retrying so we don't burn API on a stuck error.
      await sleep(30_000);
    }
  }

  console.log("[live] stopped.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case "init":
      await init(rest);
      break;
    case "cycle":
      await cycleOnce();
      break;
    case "live":
      await live();
      break;
    case "status":
      await statusCmd();
      break;
    case "login":
      await loginCmd();
      break;
    case "logout":
      await logoutCmd();
      break;
    case "whoami":
      await whoamiCmd();
      break;
    case "inbox":
      await inboxCmd();
      break;
    case "reply":
      await replyCmd(rest);
      break;
    case "self-test":
      await selfTest(rest);
      break;
    case "_mock-cycle":
      // Internal command invoked by runSelfTest's mock-cycle check.
      // Runs one cycle with mock LLM. Exit 0 = healthy, non-zero = broken.
      await runMockCycleTest();
      break;
    default:
      console.error(
        "usage: cli.ts <init|cycle|live|status|login|logout|whoami|inbox|reply|self-test>",
      );
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

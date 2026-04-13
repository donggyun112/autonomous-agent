// The thin entry point. Process control commands only — this is not the
// agent's UI. Eventually a Discord surface will subscribe to the cycle
// observer and present the agent's life there.
//
//   cli.ts init <name>             — first birth. Creates body files. Refuses if data/ exists.
//   cli.ts cycle                   — run one cycle in the current mode and exit.
//   cli.ts live                    — daemon. Cycles forever; honors agent-requested sleep; performs molt swaps.
//   cli.ts self-test <generationId> — used internally by the molt protocol.
//
// Profile support: --profile <name> sets AGENT_PROFILE env var.
// NOTE: In ESM, static imports are hoisted and evaluated before module code
// runs. The --profile flag here therefore does NOT affect paths.ts on first
// load (paths.ts initializes DATA at import time). For profiles to work
// correctly, set the env var BEFORE launching:
//   AGENT_PROFILE=foo pnpm cycle
// The flag below is a convenience for tsx which evaluates sequentially, and
// a documentation aid. For pure Node ESM, use the env var directly.
{
  const args = process.argv;
  const idx = args.indexOf("--profile");
  if (idx !== -1 && args[idx + 1]) {
    process.env.AGENT_PROFILE = args[idx + 1];
  }
}

import { existsSync } from "fs";
import { mkdir, readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { createInterface } from "readline/promises";
import { runCycle } from "./core/cycle.js";
import { popDueWake } from "./core/scheduled-wakes.js";
import {
  checkInbox as checkInboxApi,
  listPendingQuestions,
  unreadInboxCount,
  userReply,
} from "./core/conversation.js";
import { birth, measureDrift } from "./core/identity.js";
import {
  cleanupPendingSwapMarker,
  incrementMoltFailureCount,
  readPendingSwap,
  resetMoltFailureCount,
  rollbackMolt,
  runMockCycleTest,
  runSelfTest,
} from "./core/molt.js";
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
import { createLiveObserver, printCycleSummary } from "./ui/observer.js";

async function init(args: string[]): Promise<void> {
  // Parse --lang flag: `init <name> --lang ko`
  let seedName = "";
  let language = "ko"; // default
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lang" && args[i + 1]) {
      language = args[++i];
    } else if (!seedName) {
      seedName = args[i].trim();
    }
  }
  if (!seedName) {
    console.error("usage: cli.ts init <seed_name> [--lang ko|en|ja]");
    console.error("  example: cli.ts init Soren --lang ko");
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
  state.language = language;
  state.bornAt = Date.now();
  state.lastTransition = Date.now();
  state.lastTransitionReason = "born";
  await saveState(state);

  console.log(`born. seed name: ${seedName}`);
  console.log(`data/ initialized. run \`pnpm cycle\` to wake for the first time.`);
}

// Live observer moved to src/ui/observer.ts — rich terminal output with
// header, gutter lines, sleep reports, and full (non-truncated) results.

async function cycleOnce(): Promise<void> {
  if (!existsSync(WHO_AM_I)) {
    console.error("not yet born. run `pnpm init <name>` first.");
    process.exit(1);
  }

  const { observer, startState, startTime } = await createLiveObserver();
  const result = await runCycle({ observer });
  printCycleSummary(result, startState, startTime);
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
    console.log("auth: (none) — run `pnpm run login` or set ANTHROPIC_API_KEY");
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

  // #22: Track consecutive cycle errors for auto-rollback after a molt.
  const ROLLBACK_THRESHOLD = 3;
  let consecutiveErrors = 0;

  let running = true;
  process.on("SIGINT", () => {
    console.log("\n[live] stopping after current cycle…");
    running = false;
  });

  let consecutiveRests = 0;

  while (running) {
    const state = await loadState();

    // Check for due scheduled wakes (schedule_wake tool). If one fires,
    // inject its intention+context into state so the next cycle sees it.
    try {
      const dueWake = await popDueWake();
      if (dueWake) {
        console.log(`\n[wake] scheduled wake fired: ${dueWake.id} — ${dueWake.intention}`);
        // If agent is sleeping, this wake overrides the remaining sleep.
        if (state.mode === "SLEEP") {
          state.wakeAfter = 0; // clear any remaining sleep timer
        }
        state.wakeIntention = dueWake.intention;
        state.wakeContext = dueWake.context;
        await saveState(state);
      }
    } catch {
      // scheduled-wakes check should never crash daemon
    }

    // SLEEP mode: run consolidation immediately. The agent's sleep is a
    // consolidation PROCESS, not a wall-clock wait. wakeAfter/sleep_minutes
    // are ignored — there's no reason for the agent to wait in real time.
    // The "duration" of sleep is however long consolidation takes (~1-2 min).
    if (state.mode === "SLEEP") {
      // Clear wakeAfter (legacy) and proceed straight to consolidation.
      if (state.wakeAfter) {
        state.wakeAfter = 0;
        await saveState(state);
      }
      // runCycle() will see mode=SLEEP → run consolidation → transition WAKE.
    }

    try {
      const { observer, startState, startTime } = await createLiveObserver();
      const result = await runCycle({ observer });
      printCycleSummary(result, startState, startTime);

      // #22: Successful cycle — reset consecutive error counter.
      consecutiveErrors = 0;
      await resetMoltFailureCount();

      // Cooldown after rest: if the agent rested without doing anything
      // meaningful (0 tool calls or reason=rested), wait before restarting
      // to prevent a tight spin loop that burns API quota.
      if (result.reason === "rested" && result.toolCalls === 0) {
        consecutiveRests += 1;
        console.log(`[live] idle rest — cooling down 60s (${consecutiveRests} consecutive)`);
        if (consecutiveRests >= 5) {
          // Agent is stuck. Clear session to break the loop.
          // Journal, whoAmI, memory, wiki all survive — only conversation cache lost.
          console.log("[live] stuck — clearing session for fresh start");
          const { clearSession } = await import("./core/session-store.js");
          await clearSession();
          consecutiveRests = 0;
        }
        await sleep(60_000);
      } else {
        consecutiveRests = 0;
        if (result.reason === "rested") {
          console.log("[live] rested — cooling down 10s");
          await sleep(10_000);
        }
      }

      // Round-6 P1 fix: after molt_swap, we need to stop the container
      // so the host can recreate it with the new image. Docker restart
      // policies reuse the same container pinned to its original image ID,
      // so a simple exit+restart doesn't pick up the retagged :current.
      //
      // The correct flow: the container exits, and a host-side mechanism
      // (scripts/supervise.sh, systemd, or manual `docker compose up -d
      // --force-recreate`) brings up a new container from :current.
      //
      // We exit with code 42 (a distinctive code) and log instructions.
      // The swap-pending marker stays on disk so the host watcher can see
      // what generation to boot. maybeCleanupSwapMarker() clears it on
      // next startup.
      const swapPending = await readPendingSwap();
      if (swapPending) {
        console.log(
          `\n[molt] swap pending: ${swapPending.generationId} — ${swapPending.reason}`,
        );
        console.log("[molt] images retagged. exiting so host can recreate container.");
        console.log("[molt] host: run `docker compose up -d --force-recreate agent`");
        process.exit(42);
      }
    } catch (err) {
      console.error(`[live] cycle error: ${(err as Error).message}`);
      consecutiveErrors += 1;

      // Classify the error — rate_limit and network errors should NOT trigger
      // rollback (they're infrastructure issues, not code bugs).
      const { classifyError } = await import("./core/errors.js");
      const classified = classifyError(err);
      const isInfraError = classified.category === "rate_limit" || classified.category === "network";
      const isParseError = (err as Error).message?.includes("JSON") || (err as Error).message?.includes("parse");
      const isNonCodeError = isInfraError || isParseError;

      if (isNonCodeError) {
        // For rate_limit/network: just back off, don't count toward rollback.
        const backoff = classified.category === "rate_limit" ? 60_000 : 30_000;
        console.log(`[live] ${classified.category} — backing off ${backoff / 1000}s`);
        await sleep(backoff);
        continue;
      }

      // Non-infra error: count toward rollback threshold.
      await incrementMoltFailureCount();
      if (consecutiveErrors >= ROLLBACK_THRESHOLD) {
        console.error(
          `[live] ${ROLLBACK_THRESHOLD} consecutive cycle errors — attempting auto-rollback…`,
        );
        try {
          const rollbackResult = await rollbackMolt(
            `${consecutiveErrors} consecutive cycle failures`,
          );
          if (rollbackResult) {
            console.log(`[molt] rolled back to ${rollbackResult.newTag}. Exiting for container recreation.`);
            process.exit(42);
          } else {
            console.error("[molt] no previous image available for rollback.");
          }
        } catch (rollbackErr) {
          console.error(`[molt] rollback failed: ${(rollbackErr as Error).message}`);
        }
      }

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
  // Strip --profile <name> from argv so subcommand parsing isn't confused.
  const rawArgs = process.argv.slice(2);
  const filteredArgs: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === "--profile" && rawArgs[i + 1]) {
      i++; // skip the value too
      continue;
    }
    filteredArgs.push(rawArgs[i]);
  }
  const [cmd, ...rest] = filteredArgs;
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
      await runMockCycleTest();
      break;
    case "doctor": {
      console.log("── self-diagnostic ──");
      try { const { getAuthSource } = await import("./llm/auth/source.js"); const s = await getAuthSource(); await s.getApiKey(); console.log("✓ auth: valid"); } catch (e) { console.log(`✗ auth: ${(e as Error).message}`); }
      console.log(existsSync(DATA) ? "✓ data/ exists" : "✗ data/ missing");
      try { await loadState(); console.log("✓ state.json parseable"); } catch { console.log("✗ state.json broken"); }
      console.log(existsSync(JOURNAL_DIR) ? "✓ journal/ exists" : "✗ journal/ missing");
      console.log(existsSync(join(DATA, "wiki")) ? "✓ wiki/ exists" : "✗ wiki/ missing");
      console.log(process.env.OPENAI_API_KEY ? "✓ OPENAI_API_KEY set" : "✗ OPENAI_API_KEY missing");
      console.log(process.env.BRAVE_API_KEY ? "✓ BRAVE_API_KEY set" : "○ BRAVE_API_KEY not set");
      try { const { memoryStats: ms } = await import("./primitives/recall.js"); const s = await ms(); console.log(`✓ memory graph: ${s.activeMemoryCount} memories`); } catch { console.log("○ memory graph: empty/not loaded"); }
      break;
    }
    default:
      console.error(
        "usage: cli.ts [--profile <name>] <init|cycle|live|status|login|logout|whoami|inbox|reply|doctor|self-test>",
      );
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

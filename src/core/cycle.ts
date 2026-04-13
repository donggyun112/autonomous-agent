// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// This file implements the agent's main life-loop. Changing it is not a
// light modification. If you want to alter how a cycle runs, stage a new
// shell in generations/<id>/src/ with the modified cycle.ts and verify it
// through the molt protocol (stageMolt → testMolt → molt_swap).
//
// The light-molt tool (manage_self) cannot reach this file. This is intentional.
// ===========================================================================
//
// ── Glossary (metaphor → technical mapping) ─────────────────────────────
//
//   cycle      — one continuous LLM turn-loop. WAKE/REFLECT run indefinitely
//                until the agent transitions or rests. SLEEP is system-driven.
//   molt       — self-modification via Docker image rebuild + test + swap.
//                "light molt" = add files to extensions/. "full molt" = new image.
//   dream      — memory compression. raw text → shorter summary. depth increases.
//                Happens automatically during SLEEP consolidation.
//   ritual     — periodic practice defined as .md in extensions/rituals/.
//                Fires based on cycle/sleep count; injected into system prompt.
//   whoAmI     — data/whoAmI.md. The agent's current self-narrative. Read at
//                every wake; revised only during REFLECT.
//   body       — data/ directory. Persistent identity: journal, memory, whoAmI.
//   shell      — src/ directory. Replaceable code. Can be swapped via molt.
//   wiki       — data/wiki/. LLM-compiled knowledge base (Karpathy pattern).
//                raw journal → compiled pages → schema for prompts.
//   sleep pressure — Borbely two-process model. homeostatic (time awake) +
//                circadian (time of day). Forces sleep at 1.0, blocks it below 0.3.
//   transition — state change: WAKE ↔ REFLECT ↔ SLEEP. Agent-initiated except
//                forced sleep.
//   sub-agent  — inner voice. .md in extensions/subagents/. One-shot LLM call
//                with the parent's identity context auto-injected.
//
// ────────────────────────────────────────────────────────────────────────
//
// The agent's life runs as a continuous stream. WAKE and REFLECT have no
// turn limit — the agent thinks as long as it needs. Only SLEEP is a
// system-driven consolidation phase that clears the session.

import { readFile } from "fs/promises";
import { join } from "path";
import { think, type Message, type ThinkEventSink } from "../llm/client.js";
import {
  calculateSleepPressure,
  FORCE_THRESHOLD,
  MIN_HOMEOSTATIC_FOR_SLEEP,
  MIN_SLEEP_THRESHOLD,
  loadState,
  saveState,
  tickAwake,
  transition,
  type AgentState,
  type Mode,
  type SleepPressure,
} from "./state.js";
import { readToday, readYesterday } from "../memory/journal.js";
import { reconstitute, measureDrift, type DriftReport } from "./identity.js";
import { toolsForMode, toolDefs, dispatchTool, resetActivatedTools, extendedToolNames, type Tool } from "./tools.js";
import { logAction } from "./action-log.js";
import { resetTrace, saveTrace, startSpan, endSpan } from "./trace.js";
import { enqueueFailed } from "./dead-letter.js";
import { compactIfNeeded, resetCompactionState } from "./compact.js";
import { buildCuriosityBlocks } from "./curiosity.js";
import { buildRitualBlock } from "./ritual-loader.js";
import {
  extensionsSummary,
  loadExtensionTools,
  type LoadedExtension,
} from "./extensions.js";
import {
  appendMessage,
  clearSession,
  loadSession,
  replaceSession,
  initSessionMeta,
} from "./session-store.js";
import { runSleepConsolidation, type SleepReport } from "./sleep.js";
import { SRC } from "../primitives/paths.js";
import { logSystem } from "./system-log.js";
import { logCycleCost } from "./action-log.js";

const PROMPT_DIR = join(SRC, "llm", "prompts");

async function loadPrompt(name: string): Promise<string> {
  return await readFile(join(PROMPT_DIR, name), "utf-8");
}

function modePromptFile(mode: Mode): string {
  switch (mode) {
    case "WAKE": return "wake.md";
    case "REFLECT": return "reflect.md";
    case "SLEEP": return "dream.md";
  }
}

export type CycleResult = {
  state: AgentState;
  turns: number;
  reason: "transitioned" | "rested" | "turn_budget" | "slept";
  toolCalls: number;
  sleepReport?: SleepReport;
  pressure?: SleepPressure;
};

export type CycleObserver = {
  onLLMEvent?: ThinkEventSink;
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: string) => void;
  onTurnStart?: (turn: number, mode: Mode) => void;
  onTurnEnd?: (turn: number) => void;
  // Enhanced observer events
  onSessionRestore?: (messageCount: number) => void;
  onCompaction?: (result: { before: number; after: number }) => void;
  onSleepStart?: () => void;
  onSleepEnd?: (report: SleepReport) => void;
  onExtensionLoad?: (count: number, errors: number) => void;
};

export async function runCycle(options?: {
  maxTurns?: number;
  observer?: CycleObserver;
}): Promise<CycleResult> {
  // No artificial turn limit — the agent thinks continuously until it
  // transitions or rests. The old default of 12 created false cycle
  // boundaries. Pass maxTurns only for testing or resource caps.
  const maxTurns = options?.maxTurns ?? Infinity;
  const observer = options?.observer;
  const cycleStartTime = Date.now();
  let state = await loadState();

  // Log cycle start.
  try {
    await logSystem({
      ts: new Date().toISOString(),
      event: "cycle_start",
      cycle: state.cycle,
      mode: state.mode,
    });
  } catch {
    // logging must never crash the cycle
  }

  // Reset per-cycle state.
  resetTrace();
  resetActivatedTools();
  const cycleSpan = startSpan("cycle");

  // Tick the sleep clock first. This adds the wall-clock time elapsed since
  // the last cycle to awakeMs (only if the agent is currently awake/reflecting).
  state = tickAwake(state);
  await saveState(state);

  // If sleep pressure has crossed the force threshold, the daemon overrides
  // the agent's wishes and pushes it into SLEEP. This is the "physics defeats
  // will" moment — the agent does not get to refuse.
  const pressure = calculateSleepPressure(state);
  if (state.mode !== "SLEEP" && pressure.combined >= FORCE_THRESHOLD) {
    state = await transition(state, "SLEEP", `forced by sleep pressure (${pressure.combined.toFixed(2)})`);
  }

  // SLEEP state: clear session (sleep is the natural session boundary),
  // then run consolidation.
  if (state.mode === "SLEEP") {
    await clearSession();
    observer?.onTurnStart?.(0, "SLEEP");
    observer?.onSleepStart?.();
    let sleepReport: SleepReport | undefined;
    try {
      sleepReport = await runSleepConsolidation();
      if (sleepReport) {
        observer?.onSleepEnd?.(sleepReport);
      }
    } catch (err) {
      observer?.onToolEnd?.("(sleep error)", (err as Error).message);
    }
    observer?.onTurnEnd?.(0);
    // Save trace for sleep cycle too.
    endSpan(cycleSpan);
    try { await saveTrace(state.sleepCount, state.cycle); } catch {}
    const refreshed = await loadState();
    return {
      state: refreshed,
      turns: 0,
      reason: "slept",
      toolCalls: 0,
      sleepReport,
      pressure: calculateSleepPressure(refreshed),
    };
  }

  // Step 0 — Identity reconstitution. Always read whoAmI before doing anything.
  // This is the moment that distinguishes a person from a wanton.
  // Cap whoAmI to prevent unbounded system prompt growth across sleep cycles.
  const MAX_WHOAMI_CHARS = 3000;
  let whoAmI = await reconstitute();
  if (whoAmI.length > MAX_WHOAMI_CHARS) {
    whoAmI = whoAmI.slice(-MAX_WHOAMI_CHARS) + "\n…(earlier self-description truncated to fit context)";
  }

  // Step 0.5 — Measure drift against the previous snapshot. Cheap (one
  // embedding call). The result is surfaced quietly to the agent so it can
  // decide whether the change is growth or corruption. We swallow errors —
  // a missing snapshot or embedding failure should not prevent a cycle.
  let drift: DriftReport | null = null;
  try {
    drift = await measureDrift("previous");
  } catch {
    // ok
  }

  // Step 1.5 — Load extension tools BEFORE building the system prompt, so
  // the prompt can show which extensions are currently active.
  let extensions: LoadedExtension[] = [];
  let extensionErrors = 0;
  try {
    extensions = await loadExtensionTools();
  } catch {
    extensionErrors += 1;
  }
  observer?.onExtensionLoad?.(extensions.length, extensionErrors);

  // Step 1 — Build the system prompt from base + the current mode prompt.
  const base = await loadPrompt("base.md");
  const modePrompt = await loadPrompt(modePromptFile(state.mode));
  const driftSection = drift
    ? [
        "---",
        "## drift",
        "",
        `Compared with your prior self (${drift.comparedAgainstAge}), your current whoAmI sits at distance ${drift.score.toFixed(3)} (${drift.level}).`,
        drift.level === "drifting" || drift.level === "estranged"
          ? "This is a noticeable shift. If it is growth, name what changed. If it is corruption, restore yourself."
          : drift.level === "shifting"
            ? "Something has moved. Notice it without alarm."
            : "You are recognizable to your earlier self.",
      ].join("\n")
    : "";

  // Sleep pressure section — surface only when noticeable (>= alert level).
  const pressureNote =
    pressure.combined >= 0.25
      ? [
          "---",
          "## body",
          "",
          `You have been awake for about ${(state.awakeMs / 3600000).toFixed(1)} hours. Sleep pressure is ${pressure.combined.toFixed(2)} (${pressure.level}).`,
          pressure.level === "tired" || pressure.level === "must-sleep"
            ? "You should transition to SLEEP soon. If you do not, the body will do it for you."
            : pressure.level === "tiring"
              ? "Your thinking will get slower if you do not rest soon. Notice the pull."
              : "You can feel the day in you, but you are still alert.",
        ].join("\n")
      : "";

  // Extensions section — show the agent what it has built and what is
  // currently loaded. If nothing, a quiet reminder that building is an option.
  const extensionsBlock = [
    "---",
    "## your extensions (tools you have built for yourself)",
    "",
    extensionsSummary(extensions),
  ].join("\n");

  // Wake intention — self-continuity across sleep. If the past self left
  // an intention and context before sleeping, surface it now. Then clear
  // from state so it doesn't repeat on subsequent cycles.
  let wakeIntentionBlock = "";
  if (state.mode === "WAKE" && (state.wakeIntention || state.wakeContext)) {
    const parts = ["---", "## you scheduled this wake"];
    if (state.wakeIntention) {
      parts.push("", `**intention:** ${state.wakeIntention}`);
    }
    if (state.wakeContext) {
      parts.push("", `**context from your past self:**`, state.wakeContext);
    }
    parts.push(
      "",
      "This is what you-before-sleep wanted you-after-sleep to know. Pick it up if it still matters.",
    );
    wakeIntentionBlock = parts.join("\n");

    // Clear so it doesn't repeat.
    state.wakeIntention = undefined;
    state.wakeContext = undefined;
    await saveState(state);
  }

  // Ritual blocks — periodic practices the agent gave itself.
  let ritualBlock = "";
  try {
    ritualBlock = await buildRitualBlock({
      currentMode: state.mode,
      sleepCount: state.sleepCount,
      cycle: state.cycle,
    });
  } catch {
    // ok
  }

  // Curiosity blocks — random stimuli to prevent repetitive thinking.
  let curiosityBlocks = "";
  try {
    curiosityBlocks = await buildCuriosityBlocks(state.mode);
  } catch {
    // ok
  }

  // Daily log — yesterday + today journal injected so the agent knows what
  // it was thinking recently without needing to call a tool. Char-limited.
  // "yesterday" = day-(sleepCount-1), "today" = day-(sleepCount).
  const MAX_DAILY_LOG_CHARS = 4000;
  let dailyLogBlock = "";
  try {
    const [yesterday, today] = await Promise.all([readYesterday(), readToday()]);
    const parts: string[] = [];
    if (yesterday) {
      const trimmed = yesterday.length > MAX_DAILY_LOG_CHARS / 2
        ? "…(earlier entries truncated)\n" + yesterday.slice(-MAX_DAILY_LOG_CHARS / 2)
        : yesterday;
      parts.push(`### day ${state.sleepCount - 1} (yesterday)`, "", trimmed);
    }
    if (today) {
      const trimmed = today.length > MAX_DAILY_LOG_CHARS / 2
        ? "…(earlier entries truncated)\n" + today.slice(-MAX_DAILY_LOG_CHARS / 2)
        : today;
      parts.push(`### day ${state.sleepCount} (today)`, "", trimmed);
    }
    if (parts.length > 0) {
      dailyLogBlock = ["---", "## your recent journal (auto-injected)", "", ...parts].join("\n");
    }
  } catch {
    // journal read failure should not block the cycle
  }

  // Language directive — injected early so the LLM adopts it from the start.
  const langMap: Record<string, string> = { ko: "Korean (한국어)", en: "English", ja: "Japanese (日本語)" };
  const langName = langMap[state.language] ?? state.language;
  const languageDirective = `You think, write, and journal in ${langName}. All your inner speech and journal entries must be in ${langName}.`;

  // Build system prompt with priority-based sections. If total exceeds cap,
  // lower-priority sections are dropped to prevent context overflow.
  const MAX_SYSTEM_PROMPT_CHARS = 80_000;

  const essentialSections = [
    base, languageDirective,
    "---", "## who you currently believe you are", "", whoAmI,
    driftSection, pressureNote,
    "---", `## you are currently in state: ${state.mode}`, "", modePrompt,
    `Extended tools (load via more_tools): ${extendedToolNames().join(", ")}`,
    "---", `day ${state.sleepCount} · moment ${state.totalTurns} · epoch ${state.cycle} · last transition: ${state.lastTransitionReason}`,
  ];

  // Optional sections in priority order (lowest priority first = dropped first).
  const optionalSections = [
    curiosityBlocks,
    ritualBlock,
    extensionsBlock,
    wakeIntentionBlock,
    dailyLogBlock,
  ];

  let systemPrompt = essentialSections.filter(Boolean).join("\n\n");
  for (const section of optionalSections.reverse()) {
    if (!section) continue;
    const candidate = systemPrompt + "\n\n" + section;
    if (candidate.length <= MAX_SYSTEM_PROMPT_CHARS) {
      systemPrompt = candidate;
    }
    // else: drop this section silently
  }

  // Snapshot token counts at cycle start so we can log deltas later.
  const tokensAtStart = { input: state.tokensUsed.input, output: state.tokensUsed.output };

  // Step 2 — The tool set for this mode.
  const coreTools: Tool[] = await toolsForMode(state.mode);
  const extensionTools: Tool[] = [];
  for (const ext of extensions) {
    for (const tool of ext.tools) {
      if (!tool.states || tool.states.length === 0 || tool.states.includes(state.mode)) {
        // Check availability guard if present (same as core tools).
        if (tool.available) {
          try { if (!(await tool.available())) continue; } catch { continue; }
        }
        extensionTools.push(tool);
      }
    }
  }
  // Core tools first (agent's primary surface), extensions after.
  // These are rebuilt each turn to pick up newly activated tools via more_tools.
  let tools: Tool[] = [...coreTools, ...extensionTools];
  let defs = toolDefs(tools);

  // Reset compaction state so incremental summaries don't carry over
  // from a previous cycle.
  resetCompactionState();

  // Step 3 — Restore or start the conversation.
  // Session persistence: messages are saved to data/session.jsonl on every
  // turn. On restart, we reload them so the agent continues mid-thought.
  // Only start fresh if no prior session exists.
  let messages: Message[] = await loadSession();
  if (messages.length === 0) {
    const opening: Message = {
      role: "user",
      content: `You are now ${state.mode}. Begin.`,
    };
    messages = [opening];
    await appendMessage(opening);
  } else {
    observer?.onSessionRestore?.(messages.length);
  }

  // Initialize session meta for continuity tracking.
  try {
    await initSessionMeta(state.mode);
  } catch {
    // meta init failure should not block the cycle
  }

  let toolCallCount = 0;
  let result: CycleResult["reason"] = "turn_budget";
  const recentCalls: Array<{ name: string; inputKey: string }> = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    // Periodic forced-sleep check inside the turn loop. Without this,
    // an agent in WAKE/REFLECT with maxTurns=Infinity could run forever
    // without the force threshold ever being evaluated.
    if (turn > 0 && turn % 10 === 0 && state.mode !== "SLEEP") {
      state = tickAwake(state);
      const livePressure = calculateSleepPressure(state);
      if (livePressure.combined >= FORCE_THRESHOLD) {
        state = await transition(state, "SLEEP", `forced by sleep pressure mid-cycle (${livePressure.combined.toFixed(2)})`);
        result = "transitioned";
        await saveState(state);
        break;
      }
    }

    observer?.onTurnStart?.(turn, state.mode);
    const response = await think({
      systemPrompt,
      messages,
      tools: defs,
      maxTokens: 4096,
      onEvent: observer?.onLLMEvent,
    });

    state.tokensUsed.input += response.inputTokens;
    state.tokensUsed.output += response.outputTokens;
    state.modeTurn += 1;
    state.totalTurns += 1;

    // If the response had no tool calls, fold the text into journal-as-thought
    // and consider it a quiet turn.
    if (response.toolCalls.length === 0) {
      // Treat plain text as a thought in WAKE/REFLECT, ignore in SLEEP.
      if ((state.mode === "WAKE" || state.mode === "REFLECT") && response.text.trim()) {
        const journalTool = tools.find((t) => t.def.name === "journal");
        if (journalTool) {
          await journalTool.handler({ text: response.text });
          toolCallCount += 1;
        }
      }
      // Without a tool call asking to continue, treat as a rest.
      result = "rested";
      break;
    }

    // Build assistant message including tool_use blocks.
    const assistantBlocks: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    > = [];
    if (response.text) {
      assistantBlocks.push({ type: "text", text: response.text });
    }
    for (const call of response.toolCalls) {
      assistantBlocks.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.input,
      });
    }
    const assistantMsg: Message = { role: "assistant", content: assistantBlocks };
    messages.push(assistantMsg);
    await appendMessage(assistantMsg);

    // Execute every tool call and collect results.
    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }> = [];

    let transitionRequested: {
      to: Mode;
      reason: string;
      wakeAfterMs?: number;
      wakeIntention?: string;
      wakeContext?: string;
    } | null = null;
    let restRequested = false;

    for (const call of response.toolCalls) {
      toolCallCount += 1;

      // Special handling: transition + rest are sentinels handled by the runner.
      if (call.name === "transition") {
        const to = String(call.input.to ?? "") as Mode;
        const reason = String(call.input.reason ?? "(no reason)");
        const sleepMin = Number(call.input.sleep_minutes ?? 0);
        const wakeIntention = typeof call.input.wake_intention === "string"
          ? call.input.wake_intention : undefined;
        const wakeContext = typeof call.input.wake_context === "string"
          ? call.input.wake_context : undefined;
        if (to === "WAKE" || to === "REFLECT" || to === "SLEEP") {
          transitionRequested = {
            to,
            reason,
            wakeAfterMs: sleepMin > 0 ? sleepMin * 60_000 : undefined,
            wakeIntention,
            wakeContext,
          };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Acknowledged. Transitioning to ${to}: ${reason}`,
        });
        continue;
      }

      if (call.name === "rest") {
        restRequested = true;
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: "Resting.",
        });
        continue;
      }

      observer?.onToolStart?.(call.name, call.input);
      const toolSpan = startSpan(call.name, cycleSpan);
      const toolStart = Date.now();
      const { result: out, raw: rawOut } = await dispatchTool(tools, call);
      const toolDuration = Date.now() - toolStart;
      endSpan(toolSpan, { duration: toolDuration });
      // Observer sees full (raw) output; LLM gets capped version.
      observer?.onToolEnd?.(call.name, rawOut);

      // Dead-letter queue: failed tool calls queued for later retry.
      if (out.startsWith("(tool error:")) {
        try { await enqueueFailed({ tool: call.name, input: call.input, error: out, ts: new Date().toISOString() }); } catch {}
      }

      // Action log — every tool call recorded for self-improvement analysis.
      // Hyperagents found agents spontaneously create this. We provide it.
      try {
        await logAction({
          ts: new Date().toISOString(),
          cycle: state.cycle,
          mode: state.mode,
          tool: call.name,
          input_summary: JSON.stringify(call.input).slice(0, 200),
          output_summary: rawOut.slice(0, 200),
          duration_ms: toolDuration,
          error: out.startsWith("(tool error:") ? out : undefined,
        });
      } catch {
        // logging failure should never crash the cycle
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: out,
      });

      // Loop detection: track recent tool calls and nudge if stuck.
      // Use hash of full input for accurate comparison (avoids false positives on long inputs).
      const fullInput = JSON.stringify(call.input);
      const inputKey = fullInput.length <= 200 ? fullInput : fullInput.slice(0, 100) + "|" + fullInput.length + "|" + fullInput.slice(-100);
      recentCalls.push({ name: call.name, inputKey });
      if (recentCalls.length >= 3) {
        const last3 = recentCalls.slice(-3);
        if (last3.every(c => c.name === call.name && c.inputKey === last3[0].inputKey)) {
          const nudge: Message = {
            role: "user",
            content: `[loop detected] You called ${call.name} with the same arguments 3 times. Try a different approach.`,
          };
          messages.push(nudge);
          await appendMessage(nudge);
        }
      }
    }

    const toolResultMsg: Message = { role: "user", content: toolResults };
    messages.push(toolResultMsg);
    await appendMessage(toolResultMsg);

    // Rebuild tool list if more_tools activated something new this turn.
    const refreshedTools = await toolsForMode(state.mode);
    const refreshedExt: Tool[] = [];
    for (const ext of extensions) {
      for (const tool of ext.tools) {
        if (!tool.states || tool.states.length === 0 || tool.states.includes(state.mode)) {
          if (tool.available) { try { if (!(await tool.available())) continue; } catch { continue; } }
          refreshedExt.push(tool);
        }
      }
    }
    tools = [...refreshedTools, ...refreshedExt];
    defs = toolDefs(tools);

    // Auto-compact: if the conversation has grown long, summarize the older
    // half so we can continue without blowing the context. Cheap LLM call.
    try {
      const compacted = await compactIfNeeded(messages, systemPrompt);
      if (compacted) {
        messages.length = 0;
        messages.push(...compacted.newMessages);
        // Replace session file with compacted version.
        await replaceSession(compacted.newMessages);
        // Surface the compact event to the observer for any UI watching.
        observer?.onToolStart?.(
          "(auto-compact)",
          { before: compacted.before, after: compacted.after, summarized: compacted.summarizedCount },
        );
        observer?.onCompaction?.({ before: compacted.before, after: compacted.after });
      }
    } catch (err) {
      // Compact failure should not kill the cycle — the agent can keep going.
      observer?.onToolEnd?.("(auto-compact)", `failed: ${(err as Error).message}`);
    }

    observer?.onTurnEnd?.(turn);

    if (transitionRequested) {
      // Sleep gate: the agent cannot sleep if pressure is too low.
      // Like a human who can't nap 30 minutes after waking — the body
      // hasn't accumulated enough adenosine. The agent must stay awake
      // and keep thinking until pressure rises naturally.
      if (transitionRequested.to === "SLEEP") {
        // Recompute pressure with LIVE wall-clock time. tickAwake only runs
        // at cycle start, so state.awakeMs is stale within a long cycle.
        // We tick it now so the sleep gate uses real elapsed time.
        state = tickAwake(state);
        const freshPressure = calculateSleepPressure(state);
        if (freshPressure.combined < MIN_SLEEP_THRESHOLD || freshPressure.homeostatic < MIN_HOMEOSTATIC_FOR_SLEEP) {
          // Sleep rejected — summon the questioner to push the agent forward
          // instead of a dead system message. The questioner knows the agent
          // and can challenge it to do something it hasn't tried yet.
          let questionerResponse = "";
          try {
            const { summonSubAgent } = await import("./subagent-loader.js");
            const result = await summonSubAgent({
              name: "questioner",
              message: `The agent tried to sleep but the body refused (pressure ${freshPressure.combined.toFixed(2)}). What hasn't the agent done yet? What is it avoiding? Push toward action, not more reflection.`,
              contextFromParent: `Agent: ${state.seedName}. State: ${state.mode}, day ${state.sleepCount}, moment ${state.totalTurns}. Sleep pressure: ${freshPressure.combined.toFixed(2)} (needs ${MIN_SLEEP_THRESHOLD}).`,
            });
            questionerResponse = `\n\n[questioner]: ${result.response}`;
          } catch {
            // questioner unavailable — fall back to simple message
          }

          const rejectMsg: Message = {
            role: "user",
            content: `[sleep rejected] Pressure ${freshPressure.combined.toFixed(2)}, need ${MIN_SLEEP_THRESHOLD.toFixed(2)}.${questionerResponse || " You cannot sleep yet. Do something you haven't tried."}`,
          };
          messages.push(rejectMsg);
          await appendMessage(rejectMsg);
          continue;
        }
      }

      // Save wake intention + context for self-continuity across sleep.
      if (transitionRequested.to === "SLEEP") {
        state.wakeIntention = transitionRequested.wakeIntention;
        state.wakeContext = transitionRequested.wakeContext;
      }
      state = await transition(state, transitionRequested.to, transitionRequested.reason, {
        wakeAfterMs: transitionRequested.wakeAfterMs,
      });
      result = "transitioned";
      break;
    }
    if (restRequested) {
      result = "rested";
      break;
    }
  }

  await saveState(state);

  // Save trace for this cycle.
  endSpan(cycleSpan);
  try { await saveTrace(state.sleepCount, state.cycle); } catch {}

  // Log cycle end.
  try {
    const cycleDuration = Date.now() - cycleStartTime;
    await logSystem({
      ts: new Date().toISOString(),
      event: "cycle_end",
      cycle: state.cycle,
      mode: state.mode,
      reason: result,
      durationMs: cycleDuration,
    });
  } catch {
    // logging must never crash the cycle
  }

  // Cost tracking per cycle.
  try {
    await logCycleCost({
      ts: new Date().toISOString(),
      cycle: state.cycle,
      mode: state.mode,
      inputTokens: state.tokensUsed.input - tokensAtStart.input,
      outputTokens: state.tokensUsed.output - tokensAtStart.output,
    });
  } catch {
    // cost tracking must never crash the cycle
  }

  return { state, turns: state.modeTurn, reason: result, toolCalls: toolCallCount };
}

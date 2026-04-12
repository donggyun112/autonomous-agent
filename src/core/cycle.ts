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
// One cycle of the agent's life.
//
// A cycle is a single turn-loop in the current mode. The agent calls tools,
// the runner dispatches them, results are fed back, and the loop continues
// until the agent calls `transition` or `rest`, or until a turn budget is hit.
//
// Long-form cycles (a full WAKE → REFLECT → SLEEP arc) are composed of
// multiple cycles invoked by the daemon (cli.ts live).

import { readFile } from "fs/promises";
import { join } from "path";
import { think, type Message, type ThinkEventSink } from "../llm/client.js";
import {
  calculateSleepPressure,
  FORCE_THRESHOLD,
  loadState,
  saveState,
  tickAwake,
  transition,
  type AgentState,
  type Mode,
  type SleepPressure,
} from "./state.js";
import { reconstitute, measureDrift, type DriftReport } from "./identity.js";
import { toolsForMode, toolDefs, dispatchTool, type Tool } from "./tools.js";
import { logAction } from "./action-log.js";
import { compactIfNeeded, resetCompactionState } from "./compact.js";
import { buildCuriosityBlocks } from "./curiosity.js";
import {
  extensionsSummary,
  loadExtensionTools,
  type LoadedExtension,
} from "./extensions.js";
import { runSleepConsolidation, type SleepReport } from "./sleep.js";
import { SRC } from "../primitives/paths.js";

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
};

export async function runCycle(options?: {
  maxTurns?: number;
  observer?: CycleObserver;
}): Promise<CycleResult> {
  const maxTurns = options?.maxTurns ?? 12;
  const observer = options?.observer;
  let state = await loadState();

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

  // SLEEP state: do not run an LLM tool loop. Instead the system performs
  // automatic consolidation operations on the agent's memory and identity.
  if (state.mode === "SLEEP") {
    observer?.onTurnStart?.(0, "SLEEP");
    let sleepReport: SleepReport | undefined;
    try {
      sleepReport = await runSleepConsolidation();
    } catch (err) {
      observer?.onToolEnd?.("(sleep error)", (err as Error).message);
    }
    observer?.onTurnEnd?.(0);
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
  const whoAmI = await reconstitute();

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
  try {
    extensions = await loadExtensionTools();
  } catch {
    // ok
  }

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

  // Curiosity blocks — random stimuli to prevent repetitive thinking.
  let curiosityBlocks = "";
  try {
    curiosityBlocks = await buildCuriosityBlocks(state.mode);
  } catch {
    // curiosity failure should never block the cycle
  }

  const systemPrompt = [
    base,
    "---",
    "## who you currently believe you are",
    "",
    whoAmI,
    driftSection,
    pressureNote,
    extensionsBlock,
    wakeIntentionBlock,
    curiosityBlocks,
    "---",
    `## you are currently in state: ${state.mode}`,
    "",
    modePrompt,
    "---",
    `cycle ${state.cycle} · sleep_count ${state.sleepCount} · last transition: ${state.lastTransitionReason}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Step 2 — The tool set for this mode.
  const coreTools: Tool[] = toolsForMode(state.mode);
  const extensionTools: Tool[] = [];
  for (const ext of extensions) {
    for (const tool of ext.tools) {
      if (!tool.states || tool.states.includes(state.mode)) {
        extensionTools.push(tool);
      }
    }
  }
  // Core tools first (agent's primary surface), extensions after.
  const tools: Tool[] = [...coreTools, ...extensionTools];
  const defs = toolDefs(tools);

  // Reset compaction state so incremental summaries don't carry over
  // from a previous cycle.
  resetCompactionState();

  // Step 3 — The conversation. The agent's first message to itself.
  const opening: Message = {
    role: "user",
    content: `You are now ${state.mode}. Begin.`,
  };
  const messages: Message[] = [opening];

  let toolCallCount = 0;
  let result: CycleResult["reason"] = "turn_budget";

  for (let turn = 0; turn < maxTurns; turn++) {
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
    messages.push({ role: "assistant", content: assistantBlocks });

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
      const toolStart = Date.now();
      const out = await dispatchTool(tools, call);
      const toolDuration = Date.now() - toolStart;
      observer?.onToolEnd?.(call.name, out);

      // Action log — every tool call recorded for self-improvement analysis.
      // Hyperagents found agents spontaneously create this. We provide it.
      try {
        await logAction({
          ts: new Date().toISOString(),
          cycle: state.cycle,
          mode: state.mode,
          tool: call.name,
          input_summary: JSON.stringify(call.input).slice(0, 200),
          output_summary: out.slice(0, 200),
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
    }

    messages.push({ role: "user", content: toolResults });

    // Auto-compact: if the conversation has grown long, summarize the older
    // half so we can continue without blowing the context. Cheap LLM call.
    try {
      const compacted = await compactIfNeeded(messages, systemPrompt);
      if (compacted) {
        messages.length = 0;
        messages.push(...compacted.newMessages);
        // Surface the compact event to the observer for any UI watching.
        observer?.onToolStart?.(
          "(auto-compact)",
          { before: compacted.before, after: compacted.after, summarized: compacted.summarizedCount },
        );
      }
    } catch (err) {
      // Compact failure should not kill the cycle — the agent can keep going.
      observer?.onToolEnd?.("(auto-compact)", `failed: ${(err as Error).message}`);
    }

    observer?.onTurnEnd?.(turn);

    if (transitionRequested) {
      // Save wake intention + context for self-continuity across sleep.
      // IN7PM pattern: context_snapshot. When the agent wakes, these are
      // injected into the system prompt so the future self picks up where
      // the past self left off.
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
  return { state, turns: state.modeTurn, reason: result, toolCalls: toolCallCount };
}

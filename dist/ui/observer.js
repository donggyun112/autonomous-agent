// Rich terminal observer for the agent's life cycle.
// Replaces the bare-bones liveObserver with structured, colored output.
// Zero external dependencies — ANSI escape codes only.
import { loadState, calculateSleepPressure } from "../core/state.js";
// ── ANSI ────────────────────────────────────────────────────
const R = "\x1b[0m"; // reset
const B = "\x1b[1m"; // bold
const DM = "\x1b[2m"; // dim
const IT = "\x1b[3m"; // italic
const UL = "\x1b[4m"; // underline
const fg = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
};
const bg = {
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
    white: "\x1b[47m",
    black: "\x1b[40m",
};
// ── Mode styling ────────────────────────────────────────────
function modeColor(mode) {
    switch (mode) {
        case "WAKE": return fg.green;
        case "REFLECT": return fg.yellow;
        case "SLEEP": return fg.blue;
    }
}
function modeBadge(mode) {
    switch (mode) {
        case "WAKE": return `${bg.green}\x1b[30m${B} WAKE ${R}`;
        case "REFLECT": return `${bg.yellow}\x1b[30m${B} REFLECT ${R}`;
        case "SLEEP": return `${bg.blue}${fg.white}${B} SLEEP ${R}`;
    }
}
function modeIcon(mode) {
    switch (mode) {
        case "WAKE": return `${fg.green}●${R}`;
        case "REFLECT": return `${fg.yellow}◐${R}`;
        case "SLEEP": return `${fg.blue}○${R}`;
    }
}
// ── Text width & wrapping ───────────────────────────────────
// Korean/CJK characters take 2 terminal columns. We must account for this
// when wrapping text manually, otherwise lines overflow the terminal.
function charWidth(ch) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x1100 && code <= 0x115F) || // Hangul Jamo
        (code >= 0x2E80 && code <= 0xA4CF) || // CJK ranges
        (code >= 0xAC00 && code <= 0xD7AF) || // Hangul Syllables
        (code >= 0xF900 && code <= 0xFAFF) || // CJK Compatibility
        (code >= 0xFE10 && code <= 0xFE6F) || // CJK forms
        (code >= 0xFF01 && code <= 0xFF60) || // Fullwidth forms
        (code >= 0xFFE0 && code <= 0xFFE6) || // Fullwidth signs
        (code >= 0x20000 && code <= 0x2FA1F) // CJK extensions
    ) {
        return 2;
    }
    return 1;
}
function visWidth(s) {
    let w = 0;
    for (const ch of s)
        w += charWidth(ch);
    return w;
}
// Split plain text into lines that fit within `maxWidth` terminal columns.
function softWrap(text, maxWidth) {
    if (maxWidth <= 0)
        return [text];
    const lines = [];
    let cur = "";
    let curW = 0;
    for (const ch of text) {
        const cw = charWidth(ch);
        if (curW + cw > maxWidth && cur) {
            lines.push(cur);
            cur = ch;
            curW = cw;
        }
        else {
            cur += ch;
            curW += cw;
        }
    }
    if (cur)
        lines.push(cur);
    return lines.length > 0 ? lines : [""];
}
// Write text that may exceed terminal width. Wraps with gutter + indent.
// `indent` = number of spaces after gutter for continuation lines.
function writeWrapped(text, mode, indent, color = "") {
    const prefix = `${gutter(mode)}${" ".repeat(indent)}`;
    const availW = cols() - 3 - indent; // 3 = gutter visible width ("  │")
    for (const srcLine of text.split("\n")) {
        const segments = softWrap(srcLine, availW);
        for (let i = 0; i < segments.length; i++) {
            if (i === 0) {
                w(`${color}${segments[i]}${color ? R : ""}\n`);
            }
            else {
                w(`${prefix}${color}${segments[i]}${color ? R : ""}\n`);
            }
        }
    }
}
// ── Helpers ─────────────────────────────────────────────────
function pressureBar(value, width = 24) {
    const filled = Math.round(value * width);
    const empty = width - filled;
    let color;
    if (value < 0.3)
        color = fg.green;
    else if (value < 0.5)
        color = fg.yellow;
    else if (value < 0.8)
        color = `\x1b[38;5;208m`; // orange (256-color)
    else
        color = fg.red;
    return `${color}${"█".repeat(filled)}${DM}${"░".repeat(empty)}${R}`;
}
function elapsed(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
}
function num(n) {
    return n.toLocaleString();
}
const w = (s) => process.stdout.write(s);
function cols() {
    return process.stdout.columns || 80;
}
function hrLine(char = "─") {
    return DM + char.repeat(cols()) + R;
}
// Tool category for coloring
function toolColor(name) {
    if (["journal", "recall_self", "recall_memory", "scan_recent", "dream"].includes(name))
        return fg.magenta; // thinking
    if (["update_whoAmI", "check_continuity"].includes(name))
        return fg.yellow; // identity
    if (name.startsWith("wiki_"))
        return fg.cyan; // knowledge
    if (["read", "web_search"].includes(name))
        return fg.blue; // world
    if (["ask_user", "consult_oracle", "check_inbox", "write_letter"].includes(name))
        return fg.green; // conversation
    if (["summon", "list_subagents", "check_subagent"].includes(name))
        return `\x1b[38;5;208m`; // inner voices (orange)
    if (name === "manage_self" || name.startsWith("molt_"))
        return fg.red; // self-modification
    if (["transition", "rest"].includes(name))
        return fg.white; // control
    return fg.cyan;
}
function gutter(mode) {
    return `${modeColor(mode)}  │${R}`;
}
// ── Header ──────────────────────────────────────────────────
function printHeader(state) {
    const pressure = calculateSleepPressure(state);
    const awakeHrs = (state.awakeMs / 3_600_000).toFixed(1);
    w(`\n${hrLine()}\n`);
    w(`  ${modeIcon(state.mode)}  ${B}${state.seedName || "agent"}${R}  ${modeBadge(state.mode)}`);
    w(`  ${DM}day ${state.sleepCount} · cycle ${state.cycle} · moment ${state.totalTurns}${R}\n`);
    w(`\n`);
    w(`  ${DM}pressure${R}  ${pressureBar(pressure.combined)} ${DM}${pressure.combined.toFixed(2)} (${pressure.level}) · awake ${awakeHrs}h${R}\n`);
    w(`  ${DM}tokens${R}    ${DM}in=${num(state.tokensUsed.input)}  out=${num(state.tokensUsed.output)}${R}\n`);
    if (state.lastTransitionReason && state.lastTransitionReason !== "born") {
        w(`  ${DM}last${R}      ${DM}${state.lastTransitionReason}${R}\n`);
    }
    w(`${hrLine()}\n`);
}
// ── Summary ─────────────────────────────────────────────────
export function printCycleSummary(result, startState, startTime) {
    const dt = Date.now() - startTime;
    const tokIn = result.state.tokensUsed.input - startState.tokensUsed.input;
    const tokOut = result.state.tokensUsed.output - startState.tokensUsed.output;
    const pressure = result.pressure ?? calculateSleepPressure(result.state);
    const reasonLabel = {
        transitioned: `${fg.cyan}transitioned${R}`,
        rested: `${fg.yellow}rested${R}`,
        turn_budget: `${fg.red}turn budget${R}`,
        slept: `${fg.blue}slept${R}`,
    };
    w(`\n${hrLine()}\n`);
    w(`  ${B}cycle complete${R}  ${reasonLabel[result.reason] ?? result.reason}\n`);
    w(`\n`);
    // Mode transition
    if (startState.mode !== result.state.mode) {
        w(`  ${DM}mode${R}      ${modeBadge(startState.mode)} ${DM}→${R} ${modeBadge(result.state.mode)}\n`);
    }
    else {
        w(`  ${DM}mode${R}      ${modeBadge(result.state.mode)}\n`);
    }
    w(`  ${DM}turns${R}     ${B}${result.turns}${R}  ${DM}tools${R} ${B}${result.toolCalls}${R}  ${DM}elapsed${R} ${B}${elapsed(dt)}${R}\n`);
    w(`  ${DM}tokens${R}    ${fg.green}+${num(tokIn)}${R} in  ${fg.green}+${num(tokOut)}${R} out\n`);
    w(`  ${DM}pressure${R}  ${pressureBar(pressure.combined)} ${DM}${pressure.combined.toFixed(2)} (${pressure.level})${R}\n`);
    // Sleep report
    if (result.sleepReport) {
        const r = result.sleepReport;
        w(`\n`);
        w(`  ${fg.blue}${B}sleep consolidation${R} ${DM}(${elapsed(r.durationMs)})${R}\n`);
        w(`  ${DM}├${R} memories ${B}${r.memoriesIngested}${R} ingested  ${DM}·${R}  dreamed ${B}${r.dreamed}${R}  ${DM}·${R}  pruned ${B}${r.pruned}${R}\n`);
        w(`  ${DM}├${R} schemas ${B}${r.schemasFormed}${R}  ${DM}·${R}  associations ${B}${r.associationsFound}${R}\n`);
        w(`  ${DM}├${R} wiki ${B}${r.wikiPagesTouched}${R} pages`);
        if (r.wikiLintFindings > 0)
            w(`  ${DM}·${R}  lint ${fg.yellow}${r.wikiLintFindings}${R}`);
        if (r.entityPagesCreated > 0)
            w(`  ${DM}·${R}  entities ${fg.green}+${r.entityPagesCreated}${R}`);
        w(`\n`);
        if (r.whoAmIUpdated) {
            w(`  ${DM}├${R} ${fg.green}whoAmI updated${R}\n`);
        }
        if (r.selfPageSynced) {
            w(`  ${DM}├${R} ${fg.green}self page synced${R}\n`);
        }
        if (r.errors.length > 0) {
            w(`  ${DM}├${R} ${fg.red}${r.errors.length} error(s)${R}\n`);
            for (const e of r.errors) {
                w(`  ${DM}│${R}   ${fg.red}${e.step}${R}: ${DM}${e.message}${R}\n`);
            }
        }
        w(`  ${DM}└${R}\n`);
    }
    // Scheduled wake
    if (result.state.wakeAfter) {
        const mins = Math.round((result.state.wakeAfter - Date.now()) / 60_000);
        if (mins > 0) {
            w(`  ${DM}wake in${R}   ~${mins}m\n`);
        }
    }
    w(`${hrLine()}\n`);
}
// ── Observer factory ────────────────────────────────────────
export async function createLiveObserver() {
    const startState = await loadState();
    const startTime = Date.now();
    let inText = false;
    let turnTools = 0;
    let currentMode = startState.mode;
    let col = 0; // current column for streaming text wrapping
    // Print the header
    printHeader(startState);
    const observer = {
        onTurnStart(turn, mode) {
            inText = false;
            turnTools = 0;
            currentMode = mode;
            const dt = elapsed(Date.now() - startTime);
            w(`\n${modeColor(mode)}  ┌─${R} ${B}turn ${turn}${R} ${DM}· ${mode} · ${dt}${R}\n`);
            w(`${gutter(mode)}\n`);
        },
        onLLMEvent(event) {
            if (event.type === "text_delta" && event.delta) {
                const contentW = cols() - 5; // 3 (gutter "  │") + 2 (indent)
                if (!inText) {
                    w(`${gutter(currentMode)}  `);
                    inText = true;
                    col = 0;
                }
                // Wrap character-by-character, accounting for CJK double-width.
                for (const ch of event.delta) {
                    if (ch === "\n") {
                        w(`\n${gutter(currentMode)}  `);
                        col = 0;
                    }
                    else {
                        const cw = charWidth(ch);
                        if (col + cw > contentW) {
                            w(`\n${gutter(currentMode)}  `);
                            col = 0;
                        }
                        w(ch);
                        col += cw;
                    }
                }
            }
        },
        onToolStart(name, input) {
            if (inText) {
                w(`${R}\n`);
                inText = false;
            }
            turnTools++;
            const color = toolColor(name);
            w(`${gutter(currentMode)}  ${color}${B}▸ ${name}${R}`);
            // Format params — show full content, wrap at terminal width
            const entries = Object.entries(input);
            if (entries.length === 0) {
                w(`\n`);
                return;
            }
            // Try inline first
            const inlineText = entries.map(([k, v]) => {
                const s = typeof v === "string" ? v : JSON.stringify(v);
                return `${k}=${s}`;
            }).join("  ");
            // gutter(3) + "  ▸ "(4) + name + " " + params
            const headerVisW = 3 + 4 + name.length + 1;
            if (headerVisW + visWidth(inlineText) <= cols()) {
                w(` ${DM}${inlineText}${R}\n`);
            }
            else {
                // Multi-line: each param wrapped with gutter
                w(`\n`);
                for (const [k, v] of entries) {
                    const s = typeof v === "string" ? v : JSON.stringify(v);
                    const keyPart = `${k}=`;
                    w(`${gutter(currentMode)}    ${DM}${keyPart}${R}`);
                    // 3 (gutter) + 4 (indent) + key= length = first line offset
                    const firstLineW = cols() - 3 - 4 - keyPart.length;
                    const restW = cols() - 3 - 6; // continuation indent = 6
                    const allText = s.split("\n");
                    let first = true;
                    for (const line of allText) {
                        const wrapW = first ? firstLineW : restW;
                        const segments = softWrap(line, wrapW);
                        for (let si = 0; si < segments.length; si++) {
                            if (first && si === 0) {
                                w(`${segments[si]}\n`);
                            }
                            else {
                                w(`${gutter(currentMode)}      ${segments[si]}\n`);
                            }
                        }
                        first = false;
                    }
                }
            }
        },
        onToolEnd(name, result) {
            // Skip noisy sentinels
            if (name === "transition" || name === "rest")
                return;
            if (result === "TRANSITION_REQUESTED" || result === "REST_REQUESTED")
                return;
            // Special: compact/sleep error styling
            if (name === "(auto-compact)") {
                w(`${gutter(currentMode)}  ${fg.magenta}⟳ compacted${R} ${DM}${result}${R}\n`);
                return;
            }
            if (name === "(sleep error)") {
                w(`${gutter(currentMode)}  ${fg.red}✗ sleep error${R} ${DM}${result}${R}\n`);
                return;
            }
            if (!result)
                return;
            const isError = result.startsWith("(tool error:") || result.startsWith("[error]");
            const marker = isError ? `${fg.red}✗${R}` : `${fg.green}✓${R}`;
            const color = isError ? fg.red : fg.gray;
            // "  │    ✓ " = gutter(3) + 4 spaces + marker(1) + space(1) = 9 cols for first line
            // "  │      " = gutter(3) + 6 spaces = 9 cols for continuation
            const firstW = cols() - 9;
            const contW = cols() - 9;
            const contPrefix = `${gutter(currentMode)}      `;
            const srcLines = result.split("\n");
            for (let li = 0; li < srcLines.length; li++) {
                const segments = softWrap(srcLines[li], li === 0 ? firstW : contW);
                for (let si = 0; si < segments.length; si++) {
                    if (li === 0 && si === 0) {
                        w(`${gutter(currentMode)}    ${marker} ${color}${segments[si]}${R}\n`);
                    }
                    else {
                        w(`${contPrefix}${color}${segments[si]}${R}\n`);
                    }
                }
            }
        },
        onTurnEnd(turn) {
            if (inText) {
                w(`${R}\n`);
                inText = false;
            }
            w(`${gutter(currentMode)}\n`);
            w(`${modeColor(currentMode)}  └─${R} ${DM}${turnTools} tool call${turnTools !== 1 ? "s" : ""}${R}\n`);
        },
        onSessionRestore(messageCount) {
            w(`  ${fg.yellow}⟳ session restored${R} ${DM}${messageCount} messages from previous run${R}\n`);
        },
        onCompaction(result) {
            w(`${gutter(currentMode)}  ${fg.magenta}⟳ compacted${R} ${DM}${result.before} → ${result.after} messages${R}\n`);
        },
        onSleepStart() {
            w(`\n  ${fg.blue}${B}☽ entering sleep consolidation...${R}\n\n`);
        },
        onSleepEnd(report) {
            w(`\n  ${fg.blue}${B}☀ consolidation complete${R} ${DM}(${elapsed(report.durationMs)})${R}\n`);
            w(`  ${DM}├${R} memories ${B}${report.memoriesIngested}${R}  ${DM}·${R}  dreamed ${B}${report.dreamed}${R}  ${DM}·${R}  pruned ${B}${report.pruned}${R}\n`);
            w(`  ${DM}├${R} schemas ${B}${report.schemasFormed}${R}  ${DM}·${R}  associations ${B}${report.associationsFound}${R}\n`);
            w(`  ${DM}├${R} wiki ${B}${report.wikiPagesTouched}${R} pages\n`);
            if (report.whoAmIUpdated)
                w(`  ${DM}├${R} ${fg.green}whoAmI updated${R}\n`);
            if (report.errors.length > 0) {
                for (const e of report.errors) {
                    w(`  ${DM}├${R} ${fg.red}${e.step}: ${e.message}${R}\n`);
                }
            }
            w(`  ${DM}└${R}\n`);
        },
        onExtensionLoad(count, errors) {
            if (count > 0 || errors > 0) {
                const errPart = errors > 0 ? ` ${fg.red}(${errors} failed)${R}` : "";
                w(`  ${fg.cyan}⚙${R} ${DM}${count} extension${count !== 1 ? "s" : ""} loaded${R}${errPart}\n`);
            }
        },
    };
    return { observer, startState, startTime };
}
//# sourceMappingURL=observer.js.map
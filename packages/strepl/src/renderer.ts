import { Writable } from "node:stream";
import { Registry } from "./registry.js";
import { type ReplState, type RenderOptions } from "./types.js";
import { COLORS, format, strip } from "./utils/ansi.js";
import { currentWord, colorInput, getHintArgs, walkNS } from "./utils/completion.js";

const MAX_DROPDOWN = 7;
const HALF_DROPDOWN = Math.floor(MAX_DROPDOWN / 2);

/**
 * Draws the active terminal state line and overlay menus onto the output stream.
 *
 * @remarks
 * Calculates previous drop lists, prints ghost hints, adds syntax text-coloring tokens,
 * renders scrolling window overlays for overflows, and highlights selection blocks.
 *
 * @param state    - Current REPL state (input, cursor position, candidates, etc.).
 * @param registry - Registry of command metadata used for completion and colouring.
 * @param promptStr - The prompt string to display (may contain ANSI codes).
 * @param jsMode   - Whether the JS VM input mode is active.
 * @param opts     - Optional rendering overrides (e.g. flash the prompt red on error).
 * @param stdout   - The writable stream to render into.
 * @param context  - Sandbox context reference passed through to colorInput.
 * @param globals  - Global variables reference passed through to colorInput.
 * @public
 */
export function render(
    state: ReplState,
    registry: Registry,
    promptStr: string,
    jsMode: boolean,
    opts: RenderOptions = {},
    stdout: Writable & { columns?: number },
    context: any,
    globals: any
): void {

    const columns = stdout.columns ?? 80;
    const { input, candidates, drawnDropdownLines, cursor, selectionAnchor } = state;
    const completionIdx = state.completionIdx;

    const coloredInput = colorInput(input, registry, jsMode, context, globals) + COLORS.reset;

    const ghost = resolveGhost(state, jsMode, candidates);

    const optionParamHint = resolveOptionParamHint(
        completionIdx,
        jsMode,
        candidates,
        registry,
        input
    );

    const ghostStr = (ghost ? format(COLORS.gray, ghost) : "") + optionParamHint;

    const hintStr = optionParamHint
        ? ""
        : buildHintStr(jsMode ? [] : getHintArgs(input, registry));

    const dropList = jsMode ? (state.jsCandidates ?? []) : candidates;
    const { visibleItems, localIdx, overflowTop, overflowBottom } = sliceDropdown(
        dropList,
        completionIdx
    );
    const showDrop = dropList.length >= 1;

    const flashPrompt = opts.flashError
        ? format(COLORS.red + COLORS.bold, strip(promptStr).trim()) + " "
        : promptStr;
    const promptVisLen = strip(promptStr).length;
    
    const xPos = Math.min(
        strip(colorInput(input.slice(0, cursor), registry, jsMode, context, globals) + COLORS.reset).length +
        promptVisLen,
        columns - 1
    );

    const range =
        selectionAnchor === null
            ? null
            : {
                  start: Math.min(cursor, selectionAnchor),
                  end:   Math.max(cursor, selectionAnchor),
              };

    let out = buildClearSequence(drawnDropdownLines);

    if (range) {
        out += buildSelectionLine(
            flashPrompt, input, range, ghostStr, hintStr,
            registry, jsMode, context, globals
        );
    } else {
        out += flashPrompt + coloredInput + COLORS.reset + ghostStr + hintStr;
    }

    let newDropLines = 0;
    if (showDrop) {
        out += buildDropdown(visibleItems, localIdx, overflowTop, overflowBottom, columns);
        newDropLines = visibleItems.length;
        out += COLORS.up(newDropLines);
    }

    out += "\r" + COLORS.right(xPos);

    state.drawnDropdownLines = newDropLines;
    stdout.write(out);
}

/**
 * Returns the ghost-completion suffix for the currently selected candidate —
 * i.e. the part of the candidate not yet typed by the user.
 */
function resolveGhost(state: ReplState, jsMode: boolean, candidates: string[]): string {
    const { completionIdx, jsCandidates, jsReplaceLen, input } = state;

    if (jsMode) {
        if (!jsCandidates?.length) return "";
        return (jsCandidates[completionIdx] ?? "").slice(jsReplaceLen ?? 0);
    }

    if (!candidates.length) return "";
    return (candidates[completionIdx] ?? "").slice(currentWord(input).length);
}

/**
 * Returns an inline parameter hint (e.g. ` <filename>`) when the currently
 * selected completion candidate is a string-typed option flag.
 * Returns an empty string in all other cases.
 */
function resolveOptionParamHint(
    completionIdx: number,
    jsMode: boolean,
    candidates: string[],
    registry: Registry,
    input: string
): string {
    if (jsMode || !candidates.length || !input.trim()) return "";

    const activeCandidate = candidates[completionIdx];
    if (!activeCandidate?.startsWith("-")) return "";

    const parts = input.trim().split(/\s+/).filter(Boolean);
    const { reg, depth } = walkNS(parts, registry);
    const cmdKey = parts[depth];
    const cmd = cmdKey ? reg.get(cmdKey) : undefined;
    if (!cmd?.options) return "";

    const opt = cmd.options.find(
        (o: any) =>
            `--${o.name}` === activeCandidate ||
            (o.short != null && `-${o.short}` === activeCandidate)
    );

    return opt?.type === "string"
        ? " " + format(COLORS.gray, `<${opt.name}>`)
        : "";
}

/**
 * Formats the positional argument hint string that appears after the input
 * (e.g. `<source> [dest]`).
 */
function buildHintStr(hintDefs: Array<{ name: string; required: boolean }>): string {
    if (!hintDefs.length) return "";
    return (
        " " +
        hintDefs
            .map((a) =>
                a.required
                    ? format(COLORS.gray, `<${a.name}>`)
                    : format(COLORS.gray + COLORS.dim, `[${a.name}]`)
            )
            .join(" ")
    );
}

interface DropdownWindow {
    visibleItems: string[];
    /** Index of the active item within `visibleItems`. */
    localIdx: number;
    /** Number of items hidden above the visible window. */
    overflowTop: number;
    /** Number of items hidden below the visible window. */
    overflowBottom: number;
}

/**
 * Computes a centered sliding window over the candidate list.
 *
 * The active item is kept visible and, wherever possible, centred within the
 * window. The window is always clamped so that it shows exactly `MAX_DROPDOWN`
 * rows when the list is long enough — fixing the original bug where rows near
 * the end of the list would produce fewer visible items than expected.
 */
function sliceDropdown(list: string[], completionIdx: number): DropdownWindow {
    const total = list.length;

    if (total <= MAX_DROPDOWN) {
        return { visibleItems: list, localIdx: completionIdx, overflowTop: 0, overflowBottom: 0 };
    }

    const min = Math.max(0, Math.min(completionIdx - HALF_DROPDOWN, total - MAX_DROPDOWN));
    const max = min + MAX_DROPDOWN;

    return {
        visibleItems:  list.slice(min, max),
        localIdx:      completionIdx - min,
        overflowTop:   min,
        overflowBottom: total - max,
    };
}

/**
 * Returns the ANSI sequence that erases previously drawn dropdown rows and
 * repositions the cursor on the prompt line, ready for the next frame.
 */
function buildClearSequence(drawnLines: number): string {
    if (drawnLines <= 0) return "\r\x1b[K";
    let seq = "\r\x1b[K";
    for (let i = 0; i < drawnLines; i++) seq += "\n\x1b[K";
    return seq + COLORS.up(drawnLines) + "\r";
}

/**
 * Low-level ANSI parser that safely injects a consistent background selection block
 * into already syntax-highlighted strings without breaking or leaking color states.
 */
function highlightSelection(ansiString: string, start: number, end: number): string {
    let result = "";
    let plainIdx = 0;
    let i = 0;
    let selectionActive = false;

    const BG_ON = "\x1b[44m"; 
    const BG_OFF = "\x1b[49m";

    while (i < ansiString.length) {
        if (!selectionActive && plainIdx >= start && plainIdx < end) {
            result += BG_ON;
            selectionActive = true;
        } 
        else if (selectionActive && (plainIdx < start || plainIdx >= end)) {
            result += BG_OFF;
            selectionActive = false;
        }

        if (ansiString[i] === "\x1b") {
            let seq = "\x1b";
            i++;
            
            if (i < ansiString.length && ansiString[i] === "[") {
                seq += "[";
                i++;
                while (i < ansiString.length) {
                    const char = ansiString[i];
                    seq += char;
                    i++;
                    if (char! >= "@" && char! <= "~") break;
                }
            } else if (i < ansiString.length) {
                seq += ansiString[i];
                i++;
            }
            
            result += seq;
            
            if (selectionActive && (seq === "\x1b[0m" || seq === "\x1b[m" || seq.endsWith("[0m"))) {
                result += BG_ON;
            }
        } 
        else {
            result += ansiString[i];
            plainIdx++;
            i++;
        }
    }

    if (selectionActive) {
        result += BG_OFF;
    }

    return result;
}

export function buildSelectionLine(
    flashPrompt: string,
    input: string,
    range: { start: number; end: number },
    ghostStr: string,
    hintStr: string,
    registry: Registry,
    jsMode: boolean,
    context: any,
    globals: any
): string {
    const coloredInput = colorInput(input, registry, jsMode, context, globals);

    const selectionLine = highlightSelection(coloredInput, range.start, range.end);

    return flashPrompt + selectionLine + ghostStr + hintStr;
}

/**
 * Renders the dropdown candidate list into an ANSI string.
 *
 * Each row occupies its own line below the prompt (lines start with `\n`).
 * Overflow indicators are right-aligned using ANSI-stripped lengths, fixing
 * the original bug where escape-code bytes were counted as visible columns.
 */
function buildDropdown(
    items: string[],
    activeIdx: number,
    overflowTop: number,
    overflowBottom: number,
    columns: number
): string {
    let out = "";

    for (let i = 0; i < items.length; i++) {
        const isActive = i === activeIdx;
        const icon  = isActive ? format(COLORS.cyan,              ">") : format(COLORS.gray, " ");
        const label = isActive ? format(COLORS.cyan + COLORS.bold, items[i]!) : format(COLORS.gray, items[i]!);
        const row = `\n  ${icon} ${label}`;

        let overflow = "";
        if (i === 0 && overflowTop > 0) {
            overflow = buildOverflowIndicator(`↑ ${overflowTop} more…`, strip(row).length, columns);
        } else if (i === items.length - 1 && overflowBottom > 0) {
            overflow = buildOverflowIndicator(`↓ ${overflowBottom} more…`, strip(row).length, columns);
        }

        out += row + overflow;
    }

    return out;
}

/**
 * Right-aligns an overflow indicator label (e.g. `↑ 3 more…`) within the
 * terminal width.
 *
 * Both `rowVisLen` and the label's visible length are measured without ANSI
 * codes, so padding is always accurate regardless of the escape sequences
 * used for colours.
 */
function buildOverflowIndicator(text: string, rowVisLen: number, columns: number): string {
    const label = format(COLORS.gray + COLORS.dim, text);
    const padding = Math.max(0, columns - rowVisLen - strip(label).length);
    return " ".repeat(padding) + label;
}
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
    stdout: Writable & { columns?: number, rows?: number },
    context: any,
    globals: any
): void {
    const columns = stdout.columns ?? 80;
    
    let activePrompt = promptStr;
    let activeInput = state.input;
    let dropList = jsMode ? (state.jsCandidates ?? []) : state.candidates;
    let hideHints = false;

    if (state.selectMode) {
        activePrompt = format(COLORS.yellow, "? ") + (state.selectPrompt || "") + " ";
        activeInput = "";
        dropList = state.selectChoices || [];
        hideHints = true;
    } else if (state.searchMode) {
        activePrompt = format(COLORS.cyan, "(reverse-i-search)") + format(COLORS.gray, ` \`${state.searchQuery}\`: `);
        activeInput = state.candidates[state.completionIdx] ?? "";
        hideHints = true;
    }

    const inputLinesAll = activeInput.split('\n');
    const isMultiline = inputLinesAll.length > 1;

    const coloredInput = colorInput(activeInput, registry, jsMode, context, globals) + COLORS.reset;
    const ghost = (hideHints || isMultiline) ? "" : resolveGhost(state, jsMode, state.candidates);
    const optionParamHint = (hideHints || isMultiline) ? "" : resolveOptionParamHint(state.completionIdx, jsMode, state.candidates, registry, state.input);
    const ghostStr = (ghost ? format(COLORS.gray, ghost) : "") + optionParamHint;
    const hintStr = (hideHints || optionParamHint || isMultiline) ? "" : buildHintStr(jsMode ? [] : getHintArgs(state.input, registry));

    const { visibleItems, localIdx, overflowTop, overflowBottom } = sliceDropdown(dropList, state.completionIdx);
    
    const showDrop = dropList.length >= 1 && !isMultiline;

    const flashPrompt = opts.flashError
        ? format(COLORS.red + COLORS.bold, strip(activePrompt).trim()) + " "
        : activePrompt;
    
    const promptVisLen = strip(activePrompt).length;
    const beforeCursor = activeInput.slice(0, state.cursor);
    const cursorLines = beforeCursor.split('\n');
    
    const currentLineText = cursorLines[cursorLines.length - 1] || "";
    const currentLineVisLen = strip(colorInput(currentLineText, registry, jsMode, context, globals) + COLORS.reset).length;
    const xPos = Math.min(promptVisLen + currentLineVisLen, columns - 1);

    const range = state.selectionAnchor === null ? null : {
        start: Math.min(state.cursor, state.selectionAnchor),
        end: Math.max(state.cursor, state.selectionAnchor),
    };

    const prevCursorLine = (state as any).prevCursorLine ?? 0;
    const prevTotalLines = state.drawnDropdownLines ?? 0;

    let out = "";
    if (prevCursorLine > 0) {
        out += COLORS.up(prevCursorLine);
    }
    out += "\r\x1b[K";
    for (let i = 0; i < prevTotalLines; i++) {
        out += "\n\x1b[K";
    }
    if (prevTotalLines > 0) {
        out += COLORS.up(prevTotalLines);
    }
    out += "\r";

    const paddingMargin = " ".repeat(promptVisLen);
    if (range) {
        out += buildSelectionLine(flashPrompt, activeInput, range, ghostStr, hintStr, registry, jsMode, context, globals);
    } else {
        out += flashPrompt + coloredInput.replace(/\n/g, '\n' + paddingMargin) + COLORS.reset + ghostStr + hintStr;
    }

    const textLinesCount = inputLinesAll.length - 1;
    let dropdownLinesCount = 0;

    if (showDrop) {
        out += buildDropdown(visibleItems, localIdx, overflowTop, overflowBottom, columns);
        dropdownLinesCount += visibleItems.length;
    }

    let currentTotalLines = textLinesCount + dropdownLinesCount;

    if (opts.statusBar) {
        const text = typeof opts.statusBar === 'function' ? opts.statusBar() : '   strepl | Ready';
        
        const absoluteFloorHeight = 7; 
        const targetSpacerLines = Math.max(0, absoluteFloorHeight - currentTotalLines);
        
        for (let i = 0; i < targetSpacerLines; i++) {
            out += `\n\x1b[K`;
        }
        out += `\n\x1b[K\x1b[44m\x1b[97m${text.padEnd(columns)}\x1b[0m`;
        
        currentTotalLines = currentTotalLines + targetSpacerLines + 1;
    }

    const linesToMoveUp = currentTotalLines - (cursorLines.length - 1);
    if (linesToMoveUp > 0) {
        out += COLORS.up(linesToMoveUp);
    }
    out += "\r" + COLORS.right(xPos);

    state.drawnDropdownLines = currentTotalLines;
    (state as any).prevCursorLine = cursorLines.length - 1;
    
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
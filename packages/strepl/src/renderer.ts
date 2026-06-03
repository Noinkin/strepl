import { Writable } from "node:stream";
import { Registry } from "./registry.js";
import { type ReplState, type RenderOptions } from "./types.js";
import { COLORS, format, strip } from "./utils/ansi.js";
import { currentWord, colorInput, getHintArgs, walkNS } from "./utils/completion.js";

const MAX_DROPDOWN = 7;

/**
 * Draws the active terminal state line and overlay menus onto the output stream.
 *
 * @remarks
 * Calculates previous drop lists, prints ghost hints, adds syntax text-coloring tokens, 
 * renders scrolling window overlays for overflows, and highlights selection blocks.
 *
 * @param state - Current mutational operational status values.
 * @param registry - Storage collection of command matching metadata records.
 * @param promptStr - Active text prompt configuration sequence string.
 * @param jsMode - Toggle flag specifying if Javascript VM syntax is active.
 * @param opts - Extensible formatting overrides like highlighted errors.
 * @param stdout - Output channel pipeline interface destination receiving strings.
 * @param context - Sandbox references map.
 * @param globals - System variables reference.
 * * @public
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
    stdout.write("\r\x1b[K" + "\x1b[J");
    const { input, candidates, drawnDropdownLines, cursor, selectionAnchor } = state;
    let { completionIdx } = state;

    const colored = colorInput(input, registry, jsMode, context, globals);
    const word = currentWord(input);

    let ghost = "";
    if (jsMode && state.jsCandidates?.length) { ghost = (state.jsCandidates[completionIdx] ?? "").slice(state.jsReplaceLen ?? 0); }
    else if (!jsMode && candidates.length) { ghost = (candidates[completionIdx] ?? "").slice(word.length); }

    const hintDefs = jsMode ? [] : getHintArgs(input, registry);
    
    let optionParamHint = "";
    if (!jsMode && candidates.length && input.trim().length > 0) {
        const activeCandidate = candidates[completionIdx];
        if (activeCandidate && activeCandidate.startsWith("-")) {
            const parts = input.trim().split(/\s+/).filter(Boolean);
            const { reg, depth } = walkNS(parts, registry);
            const cmd = parts[depth] ? reg.get(parts[depth]!) : undefined;
            
            if (cmd && cmd.options) {
                const opt = cmd.options.find((o: any) => 
                    `--${o.name}` === activeCandidate || (o.short && `-${o.short}` === activeCandidate)
                );
                if (opt && opt.type === "string") {
                    optionParamHint = " " + format(COLORS.gray, `<${opt.name}>`);
                }
            }
        }
    }

    const ghostStr = (ghost ? format(COLORS.gray, ghost) : "") + optionParamHint;
    
    const hintStr = optionParamHint ? "" : (hintDefs.length
        ? " " +
          hintDefs
              .map((a) =>
                  a.required
                      ? format(COLORS.gray, `<${a.name}>`)
                      : format(COLORS.gray + COLORS.dim, `[${a.name}]`),
              )
              .join(" ")
        : "");

    const dropList = jsMode ? (state.jsCandidates ?? []) : candidates;
    const dropListLength = dropList.length;
    let dropItems: string[]; let overflow = 0; let overflowTop = 0;
    
    if (dropListLength > MAX_DROPDOWN) {
        const min = Math.max(0, completionIdx - Math.floor(MAX_DROPDOWN / 2));
        const max = Math.min(dropListLength, min + MAX_DROPDOWN);
        overflowTop = min; overflow = dropListLength - max;
        dropItems = dropList.slice(min, max); completionIdx = completionIdx - min;
    } else { dropItems = dropList; }
    const showDrop = dropListLength >= 1;

    let out = "";
    if (drawnDropdownLines > 0) { out += "\r\x1b[K"; for (let i = 0; i < drawnDropdownLines; i++) out += "\n\x1b[K"; out += COLORS.up(drawnDropdownLines) + "\r"; } 
    else { out += "\r\x1b[K"; }

    const flashPrompt = opts.flashError ? format(COLORS.red + COLORS.bold, strip(promptStr).trim()) + " " : promptStr;
    const promptLen = strip(promptStr).length;
    const visibleBeforeCursor = strip(colorInput(input.slice(0, cursor), registry, jsMode, context, globals)).length;
    const xPos = visibleBeforeCursor + promptLen;

    const range = selectionAnchor === null ? null : { start: Math.min(cursor, selectionAnchor), end: Math.max(cursor, selectionAnchor) };
    if (range) {
        const beforeColored = colorInput(input.slice(0, range.start), registry, jsMode, context, globals);
        const selectedColored = "\x1b[7m" + input.slice(range.start, range.end) + COLORS.reset;
        const afterColored = colorInput(input.slice(range.end), registry, jsMode, context, globals);
        out += flashPrompt + beforeColored + selectedColored + afterColored + ghostStr + hintStr;
    } else { out += flashPrompt + colored + ghostStr + hintStr; }

    let newDropLines = 0;
    if (showDrop) {
        const columns = stdout.columns || 80;
        for (let i = 0; i < dropItems.length; i++) {
            const active = i === completionIdx;
            const icon = active ? format(COLORS.cyan, ">") : format(COLORS.gray, " ");
            const label = active ? format(COLORS.cyan + COLORS.bold, dropItems[i]!) : format(COLORS.gray, dropItems[i]!);
            if (i === 0 && overflowTop > 0) {
                let overflowLabel = format(COLORS.gray + COLORS.dim, `↑ ${overflowTop} more…`);
                const outString = `\n  ${icon} ${label}`;
                overflowLabel = " ".repeat(Math.max(0, columns - outString.length - overflowLabel.length - 20)) + overflowLabel;
                out += `${outString}${overflowLabel}`;
            } else if (i === (dropItems.length - 1) && overflow > 0) {
                let overflowLabel = format(COLORS.gray + COLORS.dim, `↓ ${overflow} more…`);
                const outString = `\n  ${icon} ${label}`;
                overflowLabel = " ".repeat(Math.max(0, columns - outString.length - overflowLabel.length - 20)) + overflowLabel;
                out += `${outString}${overflowLabel}`;
            } else { out += `\n  ${icon} ${label}`; }
            newDropLines++;
        }
        out += COLORS.up(newDropLines) + "\r" + COLORS.right(xPos);
    } else if (input.length > 0 && xPos < strip(flashPrompt + colored + ghostStr + hintStr).length) { out += "\r" + COLORS.right(xPos); }

    state.drawnDropdownLines = newDropLines;
    stdout.write(out);
}
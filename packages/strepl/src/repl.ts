import { Readable, Writable } from "node:stream";
import { type CommandDefinition, type ReplOptions, type ReplState, type RenderOptions, type ArgDefinition, type CommandInternal } from "./types.js";
import { COLORS, KEYS, format, strip, sleep } from "./utils/ansi.js";
import { walkNS, getCandidates, getJSCandidates, validate, currentWord, getLevenshteinDistance } from "./utils/completion.js";
import { Registry } from "./registry.js";
import { JSSandbox } from "./sandbox.js";
import { render } from "./renderer.js";
import clipboard from "clipboardy";

/**
 * Functional wrapper signature representing lifecycle hook callbacks processed around execution periods.
 * * @public
 */
type HookFn = (raw: string, context: any, globals: any) => void | Promise<void>;

/**
 * Primary stateful orchestrator managing terminal streams, inputs, UI rendering, and script evaluation.
 *
 * @remarks
 * Instantiates terminal raw environments to manage input text buffers, processes visual dropdown multi-line items,
 * and maintains history and selection spaces for customized user sessions.
 *
 * @public
 */
export class Repl {
    #registry = new Registry();
    #history: string[] = [];
    #histIdx = -1;
    #mlBuffer: string[] = [];
    #before: HookFn[] = [];
    #after: HookFn[] = [];
    #prompt = format(COLORS.green + COLORS.bold, ">") + " ";
    #jsPrompt = format(COLORS.yellow + COLORS.bold, "js >") + " ";
    #jsMode = false;
    #sandbox!: JSSandbox;
    #askingResolver: ((val: string) => void) | null = null;
    
    #stdin: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
    #stdout: Writable & { columns?: number };

    #state: ReplState = {
        input: "",
        candidates: [],
        completionIdx: 0,
        drawnDropdownLines: 0,
        jsCandidates: [],
        jsReplaceLen: 0,
        cursor: 0,
        selectionAnchor: null,
    };

    /**
     * Contextual operational application state accessible in custom command hooks and run pipelines.
     */
    context: Record<string, any>;
    /**
     * Registered structural package tooling and globals bound into Javascript VM contexts.
     */
    globals: Record<string, any>;

    /**
     * Initializes an instances of the interactive REPL shell environment.
     *
     * @param opts - Initialization parameters structuring system context records and stream pipes.
     */
    constructor(opts: ReplOptions = {}) {
        this.context = opts.context ?? {};
        this.globals = opts.globals ?? {};
        this.#stdin = opts.stdin ?? process.stdin;
        this.#stdout = opts.stdout ?? process.stdout;
        this.#registerBuiltins();

        process.stdout.on('resize', () => {
            this.#draw(); 
        });
    }

    /**
     * Fluent interface attaching an executable or namespace definition to the application environment.
     *
     * @param def - Target layout configuring paths, command targets, or branch directories.
     * @returns Context instance enabling chained command attachments.
     */
    command(def: CommandDefinition): this {
        this.#registry.add(def);
        return this;
    }

    /**
     * Registers an interception hook executing prior to executing valid matching user inputs.
     *
     * @param fn - Interceptor block function. Throwing inside halts downstream command executions.
     * @returns Context instance enabling chained interceptor definitions.
     */
    before(fn: HookFn): this {
        this.#before.push(fn);
        return this;
    }

    /**
     * Registers a post-execution completion monitoring hook triggered when commands finalize correctly.
     *
     * @param fn - Post-execution diagnostic monitoring function.
     * @returns Context instance enabling chained monitoring definitions.
     */
    after(fn: HookFn): this {
        this.#after.push(fn);
        return this;
    }

    /**
     * Asks a yes/no question and waits for a valid response, resolving with the answer.
     * @param prompt - The question to present to the user, describing the decision at hand.
     * @returns A promise that resolves to "y" or "n" based on the user's input.
     */
    async ask(prompt: string): Promise<string> {
        this.#stdout.write(`\n  ${format(COLORS.yellow, '?')} ${prompt} `);
        return new Promise((resolve) => {
            this.#askingResolver = resolve;
        });
    }

    /**
     * Renders an array of objects as a formatted table.
     * @param data - Array of objects to display.
     * @param options - Configuration for table styling (bordered, padding).
     */
    table(data: any[], options: { bordered?: boolean, padding?: number } = {}): void {
        const { bordered = false, padding = 1 } = options;

        if (!data || data.length === 0) {
            this.#stdout.write(format(COLORS.gray, "  No data to display.\n"));
            return;
        }

        const keys = Object.keys(data[0]);
        const colWidths = keys.map((key) =>
            Math.max(strip(key).length, ...data.map((row) => strip(String(row[key] || "")).length))
        );

        const pad = " ".repeat(padding);
        const sep = bordered ? "│" : "  ";

        const renderRow = (values: string[]) => {
            const cells = values.map((val, i) => `${pad}${val.padEnd(colWidths[i]!)}${pad}`);
            return bordered ? `${sep}${cells.join(sep)}${sep}` : cells.join(sep);
        };

        this.#stdout.write("\n");

        if (bordered) {
            const top = `┌${colWidths.map(w => "─".repeat(w + padding * 2)).join("┬")}┐`;
            this.#stdout.write(`  ${top}\n`);
        }

        // Draw Header
        const header = renderRow(keys);
        this.#stdout.write(`  ${format(COLORS.bold + COLORS.blue, header)}\n`);

        if (bordered) {
            const mid = `├${colWidths.map(w => "─".repeat(w + padding * 2)).join("┼")}┤`;
            this.#stdout.write(`  ${mid}\n`);
        } else {
            this.#stdout.write(`  ${"-".repeat(strip(header).length)}\n`);
        }

        for (const row of data) {
            const values = keys.map(k => String(row[k] || ""));
            this.#stdout.write(`  ${renderRow(values)}\n`);
        }

        if (bordered) {
            const bot = `└${colWidths.map(w => "─".repeat(w + padding * 2)).join("┴")}┘`;
            this.#stdout.write(`  ${bot}\n`);
        }
        
        this.#stdout.write("\n");
    }

    /**
     * Shows a spinner. Returns a stop function.
     * Usage: const stop = this.spinner("Loading..."); await task(); stop();
     */
    spinner(text: string): () => void {
        const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        let i = 0;
        
        // Hide cursor
        this.#stdout.write("\x1b[?25l");
        
        const id = setInterval(() => {
            const frame = format(COLORS.cyan, frames[i++ % frames.length]!);
            this.#stdout.write(`\r  ${frame} ${text}`);
        }, 80);

        return () => {
            clearInterval(id);
            this.#stdout.write("\r\x1b[K"); // Clear line
            this.#stdout.write("\x1b[?25h"); // Show cursor
        };
    }

    /**
     * Renders a progress bar. 
     * Usage: const update = repl.progress("Building..."); update(0.5); // 50%
     */
    progress(label: string): (percent: number) => void {
        const width = 30;
        this.#stdout.write(`\n  ${label}\n`);
        
        return (percent: number) => {
            const filled = Math.round(width * percent);
            const bar = "█".repeat(filled) + "░".repeat(width - filled);
            this.#stdout.write(`\r  ${bar} ${Math.round(percent * 100)}%`);
            if (percent >= 1) this.#stdout.write("\n");
        };
    }

    /**
     * Wraps a string (or multi-line string) in an ASCII box.
     * @param content - The text to wrap (supports newlines).
     * @param padding - Optional horizontal padding (default 1).
     */
    box(content: string, padding: number = 1): string {
        const lines = content.split('\n');
        
        // Calculate max width based on VISIBLE characters (stripping ANSI codes)
        const visibleLengths = lines.map(l => strip(l).length);
        const width = Math.max(...visibleLengths);
        const pad = " ".repeat(padding);

        // Build borders
        const top = `┌${"─".repeat(width + padding * 2)}┐`;
        const bottom = `└${"─".repeat(width + padding * 2)}┘`;

        // Process lines: pad the right side to match max width
        const middle = lines.map(line => {
            const visibleLen = strip(line).length;
            const extraSpace = width - visibleLen;
            return `│${pad}${line}${" ".repeat(extraSpace)}${pad}│`;
        }).join('\n');

        return `${top}\n${middle}\n${bottom}`;
    }

    /**
     * Switches the selected stream target to interactive raw conditions and spins up active key reading pipelines.
     *
     * @throws Error - Thrown if the initialized input stream device is not an interactive terminal environment.
     * @returns Reference to this active execution framework instance.
     */
    start(): this {
        if (!this.#stdin.isTTY) {
            console.error("Needs an interactive terminal.");
            process.exit(1);
        }
        this.#sandbox = new JSSandbox(this.context, this.globals);
        if (typeof this.#stdin.setRawMode === "function") {
            this.#stdin.setRawMode(true);
        }
        this.#stdin.resume();
        this.#stdin.setEncoding("utf8");
        this.#stdout.write(
            "\n" +
                format(COLORS.cyan + COLORS.bold, "  REPL") +
                "\n" +
                format(
                    COLORS.gray,
                    '  Tab accept · ↑↓ cycle/history · "js" for JS mode · Ctrl+C exit',
                ) +
                "\n\n",
        );
        this.#draw();
        this.#stdin.on("data", (key: string) => this.#onKey(key));
        return this;
    }

    get #activePrompt(): string {
        return this.#jsMode ? this.#jsPrompt : this.#prompt;
    }

    #parseOptionsAndArgs(parts: string[], cmd: CommandInternal): { args: string[]; options: Record<string, any> } {
        const args: string[] = [];
        const options: Record<string, any> = {};

        for (const opt of cmd.options) {
            options[opt.name] = opt.type === "boolean" ? false : null;
        }

        for (let i = 0; i < parts.length; i++) {
            const p = parts[i]!;
            if (p.startsWith("-")) {
                let keyToken = p;
                let valToken: string | null = null;

                if (p.includes("=")) {
                    const idx = p.indexOf("=");
                    keyToken = p.slice(0, idx);
                    valToken = p.slice(idx + 1);
                }

                const name = keyToken.startsWith("--") ? keyToken.slice(2) : null;
                const short = !name && keyToken.startsWith("-") ? keyToken.slice(1) : null;
                const opt = cmd.options?.find(o => (name && o.name === name) || (short && o.short === short));

                if (opt) {
                    if (opt.type === "boolean") {
                        options[opt.name] = valToken ? valToken === "true" : true;
                    } else {
                        if (valToken !== null) {
                            options[opt.name] = valToken;
                        } else if (i + 1 < parts.length && !parts[i + 1]!.startsWith("-")) {
                            options[opt.name] = parts[i + 1];
                            i++;
                        }
                    }
                }
                continue;
            }
            args.push(p);
        }

        return { args, options };
    }

    #draw(opts?: RenderOptions): void {
        render(
            this.#state,
            this.#registry,
            this.#activePrompt,
            this.#jsMode,
            opts,
            this.#stdout,
            this.context,
            this.globals
        );
    }

    #refreshCandidates(): void {
        const s = this.#state;
        if (this.#jsMode) {
            const { candidates, replaceLen } = getJSCandidates(
                s.input,
                this.#sandbox.root,
            );
            s.jsCandidates = candidates;
            s.jsReplaceLen = replaceLen;
            s.candidates = [];
            s.completionIdx = 0;
        } else {
            s.candidates = getCandidates(s.input, this.#registry, this.context, this.globals);
            s.jsCandidates = [];
            s.jsReplaceLen = 0;
            s.completionIdx = 0;
        }
    }

    async #onKey(key: string): Promise<void> {
        if (key === KEYS.escape) {
            if (this.#jsMode) {
                this.#exitJSMode();
            } else this.#enterJSMode();
            return;
        }

        if (this.#askingResolver) {
            if (key === "y" || key === "Y") key = "y"
            else if (key === "n" || key === "N") key = "n";
            else return;
            const resolve = this.#askingResolver;
            this.#askingResolver = null;
            this.#state.input = "";
            this.#state.cursor = 0;
            this.#draw();
            resolve(key);
            return;
        }

        switch (key) {
            case KEYS.ctrlBackspace: {
                const input = this.#state.input;
                const split = input.slice(0, this.#state.cursor).split(' ');
                if (split.length > 1) {
                    if (split[split.length - 1] === "") split.pop();
                    split.pop();
                    const newCursor = split.join(" ").length;
                    this.#state.input = input.slice(0, newCursor) + input.slice(this.#state.cursor);
                    this.#state.cursor = newCursor;
                } else {
                    this.#state.input = "";
                    this.#state.cursor = 0;
                }
                this.#state.selectionAnchor = null;
                this.#histIdx = -1;
                this.#refreshCandidates();
                this.#draw();
                return;
            }
            case KEYS.altC:
            case KEYS.altC2:
                if (this.#state.selectionAnchor === null) {
                    await clipboard.write(this.#state.input);
                } else {
                    const range = this.#getSelectionRange();
                    if (range) {
                        await clipboard.write(
                            this.#state.input.slice(range.start, range.end),
                        );
                    }
                }
                return;
            case KEYS.altV:
            case KEYS.altV2:
            case KEYS.ctrlV: {
                const clip = await clipboard.read();
                if (clip) {
                    const i = this.#state.cursor;
                    this.#state.input =
                        this.#state.input.slice(0, i) +
                        clip +
                        this.#state.input.slice(i);
                    this.#state.cursor = i + clip.length;
                    this.#histIdx = -1;
                    this.#refreshCandidates();
                    this.#draw();
                }
                return;
            }
            case KEYS.ctrlC:
            case KEYS.ctrlD:
                return this.#exit();
            case KEYS.ctrlU:
                this.#state.input = "";
                this.#state.cursor = 0;
                this.#refreshCandidates();
                return this.#draw();
            case KEYS.ctrlA:
                this.#clearSelection();
                this.#state.cursor = 0;
                this.#startSelectionIfNeeded();
                this.#state.cursor = this.#state.input.length;
                return this.#draw();
            case KEYS.enter:
                return this.#execute();
            case KEYS.backspace: {
                const s = this.#state;
                const range =
                    this.#state.selectionAnchor === null
                        ? null
                        : {
                              a: Math.min(s.cursor, s.selectionAnchor!),
                              b: Math.max(s.cursor, s.selectionAnchor!),
                          };

                if (
                    range &&
                    range.a !== range.b &&
                    range.a >= 0 &&
                    range.b <= s.input.length
                ) {
                    s.input =
                        s.input.slice(0, range.a) + s.input.slice(range.b);
                    s.cursor = range.a;
                    s.selectionAnchor = null;
                } else {
                    if (s.cursor === 0) return;
                    s.input =
                        s.input.slice(0, s.cursor - 1) +
                        s.input.slice(s.cursor);
                    s.cursor--;
                }

                s.selectionAnchor = null;
                this.#histIdx = -1;
                this.#refreshCandidates();
                return this.#draw();
            }
            case KEYS.tab:
                return this.#accept();
            case KEYS.arrowUp:
                return this.#navUp();
            case KEYS.arrowDown:
                return this.#navDown();
            case KEYS.arrowRight:
                this.#clearSelection();
                this.#state.cursor = Math.min(
                    this.#state.input.length,
                    this.#state.cursor + 1,
                );
                return this.#draw();
            case KEYS.arrowLeft:
                this.#clearSelection();
                this.#state.cursor = Math.max(0, this.#state.cursor - 1);
                return this.#draw();
            case KEYS.shiftRight:
                this.#startSelectionIfNeeded();
                this.#state.cursor = Math.min(
                    this.#state.input.length,
                    this.#state.cursor + 1,
                );
                return this.#draw();
            case KEYS.shiftLeft:
                this.#startSelectionIfNeeded();
                this.#state.cursor = Math.max(0, this.#state.cursor - 1);
                return this.#draw();
            default: {
                if (key.startsWith("\x1b")) return;

                const s = this.#state;

                const range = this.#getSelectionRange();
                if (range) {
                    s.input =
                        s.input.slice(0, range.start) +
                        s.input.slice(range.end);
                    s.cursor = range.start;
                    s.selectionAnchor = null;
                }

                if (this.#jsMode) {
                    const PAIRS: Record<string, string> = {
                        "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`",
                    };
                    const CLOSERS = new Set([")", "]", "}", '"', "'", "`"]);
                    const charAfter = s.input[s.cursor] ?? "";

                    if (CLOSERS.has(key) && charAfter === key) {
                        s.cursor++;
                        return this.#draw();
                    }

                    if (key in PAIRS) {
                        const close = PAIRS[key]!;
                        const shouldPair = !(
                            ["'", '"', "`"].includes(key) &&
                            /\w/.test(charAfter)
                        );
                        if (shouldPair) {
                            s.input =
                                s.input.slice(0, s.cursor) +
                                key +
                                close +
                                s.input.slice(s.cursor);
                            s.cursor++;
                            this.#histIdx = -1;
                            this.#refreshCandidates();
                            return this.#draw();
                        }
                    }
                }

                const i = s.cursor;
                s.input = s.input.slice(0, i) + key + s.input.slice(i);
                s.cursor = i + key.length;
                this.#histIdx = -1;
                this.#refreshCandidates();
                this.#draw();
            }
        }
    }

    #getSelectionRange(): { start: number; end: number } | null {
        const s = this.#state;
        if (s.selectionAnchor === null) return null;

        const a = Math.min(s.cursor, s.selectionAnchor);
        const b = Math.max(s.cursor, s.selectionAnchor);

        if (a === b) return null;
        return { start: a, end: b };
    }

    #clearSelection(): void {
        this.#state.selectionAnchor = null;
    }

    #startSelectionIfNeeded(): void {
        if (this.#state.selectionAnchor === null) {
            this.#state.selectionAnchor = this.#state.cursor;
        }
    }

    #accept(): void {
        const s = this.#state;

        if (this.#jsMode) {
            const chosen = s.jsCandidates[s.completionIdx];
            if (!chosen) return;
            s.input =
                s.input.slice(0, s.input.length - s.jsReplaceLen) + chosen;
            this.#refreshCandidates();
            this.#state.cursor = s.input.length;
            return this.#draw();
        }

        if (!s.candidates.length) return;
        const word = currentWord(s.input);
        const chosen = s.candidates[s.completionIdx] ?? "";
        if (!chosen) return;
        s.input = s.input.slice(0, s.input.length - word.length) + chosen + " ";
        this.#state.cursor = s.input.length;
        this.#refreshCandidates();
        this.#draw();
    }

    #navUp(): void {
        const s = this.#state;
        const lst = this.#jsMode ? s.jsCandidates : s.candidates;
        if (lst.length > 1) {
            s.completionIdx = (s.completionIdx - 1 + lst.length) % lst.length;
            this.#draw();
        } else {
            this.#histNav(1);
        }
    }

    #navDown(): void {
        const s = this.#state;
        const lst = this.#jsMode ? s.jsCandidates : s.candidates;
        if (lst.length > 1) {
            s.completionIdx = (s.completionIdx + 1) % lst.length;
            this.#draw();
        } else {
            this.#histNav(-1);
        }
    }

    #histNav(dir: number): void {
        if (!this.#history.length) return;
        this.#histIdx = Math.max(
            -1,
            Math.min(this.#history.length - 1, this.#histIdx + dir),
        );
        this.#state.input =
            this.#histIdx >= 0 ? this.#history.at(-1 - this.#histIdx)! : "";
        this.#state.cursor = this.#state.input.length;
        this.#refreshCandidates();
        this.#draw();
    }

    #enterJSMode(): void {
        this.#jsMode = true;
        this.#state.input = "";
        this.#state.cursor = 0;
        this.#refreshCandidates();
        this.#state.drawnDropdownLines = 0;
        this.#stdout.write("\x1b[2J\x1b[H");
        this.#stdout.write(
            "\n" +
                format(COLORS.yellow + COLORS.bold, "  JS mode") +
                format(COLORS.gray, ' — Esc, "exit", or "js" to leave\n\n'),
        );
        this.#draw();
    }

    #exitJSMode(): void {
        this.#jsMode = false;
        this.#state.input = "";
        this.#state.cursor = 0;
        this.#refreshCandidates();
        this.#state.drawnDropdownLines = 0;
        this.#stdout.write("\x1b[2J\x1b[H");
        this.#stdout.write("\n" + format(COLORS.gray, "  Command mode\n\n"));
        this.#draw();
    }

    async #execute(): Promise<void> {
        const s = this.#state;

        if (s.drawnDropdownLines > 0) {
            let out = "";
            for (let i = 0; i < s.drawnDropdownLines; i++) out += "\n\x1b[K";
            out += COLORS.up(s.drawnDropdownLines);
            this.#stdout.write(out);
            s.drawnDropdownLines = 0;
        }
        this.#stdout.write("\n");

        if (s.input.trimEnd().endsWith("\\")) {
            this.#mlBuffer.push(s.input.trimEnd().slice(0, -1).trim());
            s.input = "";
            this.#refreshCandidates();
            this.#stdout.write(format(COLORS.gray, "... "));
            return;
        }

        const lines = [...this.#mlBuffer, s.input.trim()].filter(Boolean);
        this.#mlBuffer = [];
        const raw = lines.join("\n");
        s.input = "";
        s.completionIdx = 0;
        s.cursor = 0;
        this.#histIdx = -1;
        this.#refreshCandidates();

        if (!raw.trim()) {
            this.#draw();
            return;
        }
        this.#history.push(raw);

        if (this.#jsMode) {
            const t = raw.trim();
            if (t === "exit" || t === "js") {
                this.#exitJSMode();
                return;
            }
            try {
                const out = await this.#sandbox.eval(raw);
                if (out === null) this.#stdout.write("\n");
                else this.#stdout.write(`  ${out}\n\n`);
            } catch (e: any) {
                this.#stdout.write(
                    format(
                        COLORS.red,
                        `  ✗ ${e.constructor.name}: ${e.message}`,
                    ) + "\n\n",
                );
            }
            this.#draw();
            return;
        }

        if (raw.trim() === "js") {
            this.#enterJSMode();
            return;
        }

        const v = validate(raw, this.#registry);
        if (!v.ok) {
            this.#stdout.write("\n");

            await this.#flash(raw);
            if (v.unknownCmd) {
                const allCommands = this.#registry.names();
                const args = raw.trim().split(/\s+/);
                const bestMatch = allCommands.reduce((prev, curr) => {
                    const dist = getLevenshteinDistance(args[0]!, curr);
                    return dist < prev.dist ? { name: curr, dist } : prev;
                }, { name: '', dist: Infinity });
                this.#stdout.write(format(COLORS.red, `  Command "${args[0]}" not found.`));
                if (bestMatch.dist < 3) { // Only suggest if distance is small
                    this.#stdout.write(format(COLORS.yellow, ` Did you mean "${bestMatch.name}"?\n`));
                } else {
                    this.#stdout.write(format(COLORS.gray, ' Type "help" for a list of commands.\n'));
                }
            }
            else if (v.needsSubcmd)
                this.#stdout.write(
                    format(
                        COLORS.red,
                        `  ✗ "${v.name}" requires a subcommand\n\n`,
                    ),
                );
            else if (v.missingArgs)
                this.#stdout.write(
                    format(COLORS.red, "  ✗ Missing: ") +
                        format(
                            COLORS.yellow,
                            v.missingArgs.map((a) => `<${a}>`).join(", "),
                        ) +
                        "\n\n",
                );
            this.#draw();
            return;
        }

        const parts = raw.split(/\s+/).filter(Boolean);
        const { reg, depth } = walkNS(parts, this.#registry);
        const cmd = reg.get(parts[depth]!);
        if (!cmd) return;

        let run = cmd.run,
            argParts = parts.slice(depth + 1);
        if (cmd.commands) {
            const sub = (cmd.commands as Registry).get(parts[depth + 1]!);
            if (sub) {
                run = sub.run;
                argParts = parts.slice(depth + 2);
            }
        }

        for (const fn of this.#before) {
            try {
                await fn(raw, this.context, this.globals);
            } catch (e: any) {
                this.#stdout.write(
                    format(COLORS.red, `  ✗ ${e.message}\n\n`),
                );
                this.#draw();
                return;
            }
        }

        const rawPayloadTokens = parts.slice(depth + 1);
        const { options } = this.#parseOptionsAndArgs(rawPayloadTokens, cmd);

        try {
            if (run) {
                try {
                await run(argParts, this.context, this.globals, options);
                } catch (e: any) {
                    this.#stdout.write(
                        format(COLORS.red, `\n  ✗ Command Execution Failed:\n  ${e.message}\n\n`),
                    );
                }
                this.#stdout.write("\n");
            }
        } catch (e: any) {
            this.#stdout.write(format(COLORS.red, `  ✗ ${e.message}\n\n`));
        }
        for (const fn of this.#after) await fn(raw, this.context, this.globals);

        this.#state.candidates = [];
        this.#state.drawnDropdownLines = 0;
        this.#state.completionIdx = 0;
        this.#state.cursor = 0;

        this.#draw();
    }

    async #flash(raw: string): Promise<void> {
        this.#stdout.write(
            `\x1b[1A\r\x1b[K` +
                format(
                    COLORS.red + COLORS.bold,
                    strip(this.#activePrompt).trim(),
                ) +
                " " +
                format(COLORS.red, raw),
        );
        await sleep(120);
        this.#stdout.write("\n");
    }

    #registerBuiltins(): void {
        this.command({
            name: "help",
            aliases: ["?"],
            description: "List commands or: help <cmd>",
            args: [
                {
                    name: "command",
                    required: false,
                    choices: () => this.#registry.names(),
                },
            ],
            run: (args) => (args.length > 0 ? this.#helpCmd(args) : this.#printHelp()),
        });

        this.command({
            name: "clear",
            description: "Clear the screen",
            run: () => {
                this.#stdout.write("\x1b[2J\x1b[H")
            },
        });

        this.command({
            name: "js",
            description: "Enter JavaScript Terminal Mode",
            run: () => this.#enterJSMode(),
        });

        this.command({
            name: "exit",
            aliases: ["quit"],
            description: "Exit",
            run: () => this.#exit(),
        });
    }

    #printHelp(): void {
        const cmds = this.#registry.all();
        const max = Math.max(...cmds.map((c) => c.name.length));
        this.#stdout.write("\n");
        for (const cmd of cmds) {
            const name = format(
                COLORS.cyan + COLORS.bold,
                cmd.name.padEnd(max),
            );
            const aliases = cmd.aliases.length
                ? format(COLORS.gray, ` (${cmd.aliases.join(", ")})`)
                : "";
            const sub = cmd.commands
                ? format(COLORS.gray + COLORS.dim, " <subcommand>")
                : "";
            const args = cmd.args
                .map((a) =>
                    a.required
                        ? format(COLORS.yellow, ` <${a.name}>`)
                        : format(COLORS.gray, ` [${a.name}]`),
                )
                .join("");
            const options = cmd.options
                .map((o) => {
                    const flag = o.short ? `-${o.short}` : `--${o.name}`;
                    const val = o.type === "boolean" ? "" : ` <${o.name}>`;
                    return format(COLORS.blue, ` [${flag}${val}]`);
                })
                .join("");
            const desc = format(
                COLORS.white + COLORS.dim,
                "  " + cmd.description,
            );
            this.#stdout.write(`  ${name}${aliases}${sub}${args}${options}${desc}\n`);
            if (cmd.commands) {
                for (const s of (cmd.commands as Registry).all()) {
                    const sa = s.args
                        .map((a) =>
                            a.required
                                ? format(COLORS.yellow, ` <${a.name}>`)
                                : format(COLORS.gray, ` [${a.name}]`),
                        )
                        .join("");
                    const so = s.options
                        ? s.options
                              .map((o) => {
                                    const flag = o.short
                                        ? `-${o.short}`
                                        : `--${o.name}`;
                                    const val = o.type === "boolean" ? "" : ` <${o.name}>`;
                                    return format(COLORS.blue, ` [${flag}${val}]`);
                                })
                              .join("")
                        : "";
                    this.#stdout.write(
                        `    ${format(COLORS.blue, s.name.padEnd(10))}${sa}${so}  ${format(COLORS.gray, s.description)}\n`,
                    );
                }
            }
        }
        this.#stdout.write("\n");
    }

    #helpCmd(path: string[]): void {
        const { reg, depth } = walkNS(path, this.#registry);
        const cmd = reg.get(path[depth]!);

        if (!cmd) {
            this.#stdout.write(format(COLORS.red, `  No command "${path.join(" ")}"\n\n`));
            return;
        }

        this.#stdout.write(`\n  ${format(COLORS.bold + COLORS.cyan, cmd.name)} ${format(COLORS.dim, cmd.description)}\n`);

        const usage = [cmd.name, ...cmd.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))].join(" ");
        this.#stdout.write(`  ${format(COLORS.gray, "Usage:")}   ${usage}\n`);

        if (cmd.aliases.length) {
            this.#stdout.write(`  ${format(COLORS.gray, "Aliases:")} ${cmd.aliases.join(", ")}\n`);
        }

        if (cmd.args.length > 0) {
            this.#stdout.write(`\n  ${format(COLORS.bold, "Arguments:")}\n`);
            for (const a of cmd.args) {
                const tag = a.required ? format(COLORS.yellow, "required") : format(COLORS.gray, "optional");
                const choices = typeof a.choices === "function" ? a.choices('', [], this.context, this.globals) : a.choices;
                const cho = choices ? format(COLORS.gray, ` (${choices.join("|")})`) : "";
                this.#stdout.write(`    ${format(COLORS.cyan, a.name.padEnd(14))} ${tag}${cho}\n`);
            }
        }

        if (cmd.options && cmd.options.length > 0) {
            this.#stdout.write(`\n  ${format(COLORS.bold, "Options:")}\n`);
            for (const opt of cmd.options) {
                const flag = [opt.short ? `-${opt.short}` : null, `--${opt.name}`].filter(Boolean).join(", ");
                const type = opt.type === "boolean" ? "[flag]" : "[value]";
                this.#stdout.write(`    ${format(COLORS.blue, flag.padEnd(14))} ${format(COLORS.dim, type)}\n`);
            }
        }

        if (cmd.commands) {
            this.#stdout.write(`\n  ${format(COLORS.bold, "Subcommands:")}\n`);
            for (const sub of (cmd.commands as Registry).all()) {
                this.#stdout.write(`    ${format(COLORS.cyan, sub.name.padEnd(14))} ${sub.description}\n`);
            }
        }

        this.#stdout.write("\n");
    }

    #exit(): void {
        const s = this.#state;
        if (s.drawnDropdownLines > 0) {
            let out = "\r\x1b[K";
            for (let i = 0; i < s.drawnDropdownLines; i++) out += "\n\x1b[K";
            this.#stdout.write(out);
        }
        this.#stdout.write("\n" + format(COLORS.gray, "  Exiting.\n"));
        process.exit(0);
    }
}

/**
 * Functional utility constructing typed and structured command option values.
 *
 * @param name - Positional tracking key descriptive label.
 * @param opts - Object constraints structuring optional/required flags and choice filters.
 * @returns An unified configuration blueprint matching ArgDefinition constraints.
 * * @public
 */
export const arg = (name: string, opts: { required?: boolean; choices?: ArgDefinition["choices"]; } = {}) => ({
    name,
    required: opts.required ?? true,
    choices: opts.choices ?? null,
});
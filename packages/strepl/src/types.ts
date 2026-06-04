import { Readable, Writable } from "node:stream";

/**
 * Structural definition specifying configuration and validation metadata for a command parameter.
 *
 * @remarks
 * Used by the completion and validation pipelines to assert bounds on runtime inputs, provide 
 * interactive visual arguments hints, and produce suggestion list arrays.
 *
 * @public
 */
export interface ArgDefinition {
    /**
     * The unique identifier labeling the target positional command argument.
     */
    name: string;
    /**
     * Flags whether execution fails immediately if this positional parameter is not filled.
     */
    required: boolean;
    /**
     * An static string array or a dynamic evaluation closure generating eligible autocomplete variations.
     */
    choices?: string[] | ((typed: string, previousArgs: string[], context: any, globals: any) => string[]) | null;
}

/**
 * Structural definition specifying configurations for unordered option flags or switches.
 */
export interface OptionDefinition {
    /**
     * The unique identifier labeling the target option flag, excluding prefix dashes. For example, "verbose" for a "--verbose" flag.
     */
    name: string;
    /**
     * Optional single-character alias serving as a shorthand for the option. For example, "v" for a "--verbose" flag.
     */
    short?: string;
    /**
     * Defines the expected data type for the option's value, which can be either a boolean (for flags) or a string (for options that require a value).
     */
    type: "boolean" | "string";
    /**
     * A brief description of the option's purpose, used in help documentation to inform users about its functionality.
     */
    description?: string;
    /**
     * An static string array or a dynamic evaluation closure generating eligible autocomplete variations for the option's value.
     */
    choices?: string[] | ((typed: string, previousArgs: string[], context: any, globals: any) => string[]) | null;
}

/**
 * Common base descriptor shared across all command nodes within the execution hierarchy.
 *
 * @public
 */
export interface BaseCommand {
    /**
     * The token label matching the textual entry input identifying the command execution route.
     */
    name: string;
    /**
     * Optional secondary string phrases that substitute as aliases for matching the root label.
     */
    aliases?: string[];
    /**
     * Summarized contextual purpose string written inside help layouts explaining functional capabilities.
     */
    description?: string;
}

/**
 * Complete specification for a leaf execution target containing operational hooks and terminal arguments.
 *
 * @remarks
 * Represents a definitive final command leaf that processes active inputs and performs application runtime operations.
 *
 * @public
 */
export interface ExecutableCommand extends BaseCommand {
    /**
     * Collection of argument parameter bounds defining names, constraints, and custom completions.
     */
    args?: ArgDefinition[];
    /**
     * Collection of option flag definitions specifying available switches, expected value types, and descriptions for help documentation.
     */
    options?: OptionDefinition[];
    /**
     * Execution callback invoked when the parser completes traversal validation matching this definition.
     * * @param args - Sanitized argument token list parsed from user raw string inputs.
     * @param context - Reference to application mutational memory states.
     * @param globals - Attached static module references or environmental injection toolkits.
     * @param options - Parsed option values.
     */
    run: (args: string[], context: any, globals: any, options: Record<string, any>) => void | Promise<void>;
    /**
     * Disallowed property structure forcing mutual exclusivity with branch namespaces.
     */
    commands?: never;
}

/**
 * Nested structural boundary housing child executable commands or secondary sub-namespaces.
 *
 * @remarks
 * Used to group groups of logically continuous operations under a unified command prefix pathway.
 *
 * @public
 */
export interface NamespaceCommand extends BaseCommand {
    /**
     * Subordinate directory hierarchy of registered command nodes nested inside this container context.
     */
    commands: CommandDefinition[];
    /**
     * Disallowed property structure forcing mutual exclusivity with leaf executions.
     */
    run?: never;
    /**
     * Disallowed property structure forcing mutual exclusivity with leaf executions.
     */
    args?: never;
}

/**
 * Union definition representing either a direct execution target or a structural namespace node.
 *
 * @public
 */
export type CommandDefinition = ExecutableCommand | NamespaceCommand;

/**
 * Canonical model format maintained within internal registration map storage definitions.
 *
 * @internal
 */
export interface CommandInternal {
    name: string;
    aliases: string[];
    description: string;
    args: ArgDefinition[];
    options: OptionDefinition[];
    commands: any | null;
    run: ((args: string[], context: any, globals: any, options: Record<string, any>) => void | Promise<void>) | null;
}

/**
 * Data store monitoring cursor tracking, buffer inputs, and selection state offsets inside an active session.
 *
 * @public
 */
export interface ReplState {
    /**
     * The current unmodified textual contents visible inside the text entry editor line.
     */
    input: string;
    /**
     * Filtered selection match results populated to generate prompt suggestion interfaces.
     */
    candidates: string[];
    /**
     * Selection index tracking the actively focused list entry within the drop UI structure.
     */
    completionIdx: number;
    /**
     * Total calculated lines populated during the previous repaint cycle to ensure precise cursor rewinds.
     */
    drawnDropdownLines: number;
    /**
     * Filtered matching keys computed against global targets while operating inside JavaScript Evaluation modes.
     */
    jsCandidates: string[];
    /**
     * The text span character length intended for removal upon picking a JavaScript candidate selection.
     */
    jsReplaceLen: number;
    /**
     * Numeric absolute offset index indicating where the text input insertion caret resides.
     */
    cursor: number;
    /**
     * The starting index offset marker where an highlighted block selection range commences.
     */
    selectionAnchor: number | null;
    /**
     * Boolean flag for history search mode.
     */
    searchMode?: boolean;
    /**
     * The current search query string used to filter command history entries when operating in search mode.
     */
    searchQuery?: string;
    /**
     * Boolean flag for user made select menus.
     */
    selectMode?: boolean;
    /**
     * The select menu prompt string.
     */
    selectPrompt?: string;
    /**
     * The list of choices to display in the select menu.
     */
    selectChoices?: string[];
}

/**
 * Configuration options required to instantiate a interactive terminal REPL runtime environment instance.
 *
 * @public
 */
export interface ReplOptions {
    /**
     * Mutational contextual execution state records shared and readable by commands.
     */
    context?: Record<string, any>;
    /**
     * Utilities, environmental bridges, and third-party dependency modules accessible inside tasks.
     */
    globals?: Record<string, any>;
    /**
     * Input listener streaming interface emitting character buffers. Defaults to `process.stdin`.
     */
    stdin?: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
    /**
     * Output writing channel receiving ANSI text payloads. Defaults to `process.stdout`.
     */
    stdout?: Writable & { columns?: number };
    /**
     * Flag indicating whether to apply a byte sequence flip for backspace and ctrl+backspace inputs, addressing inconsistencies in certain terminal environments. Defaults to `false`.
     */
    flipBackspace?: boolean;
    /**
     * File path string specifying where to persist command history logs across sessions. If undefined, command history will not be saved between sessions.
     */
    historyFile?: string;
    /**
     * Boolean toggle or dynamic evaluation function determining whether to render a status bar dock below the prompt.
     */
    statusBar?: boolean | (() => string);
}

/**
 * UI visual overrides applied on rendering operations.
 *
 * @public
 */
export interface RenderOptions {
    /**
     * Forces the current text prompt frame to flash a highlighted error visual accent state.
     */
    flashError?: boolean;
    /**
     * Boolean toggle or dynamic evaluation function determining whether to render a status bar dock below the prompt.
     */
    statusBar?: boolean | (() => string);
}
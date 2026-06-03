/**
 * Collection of ANSI terminal text color escape sequences.
 * * @public
 */
export const COLORS = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    cyan: "\x1b[96m",
    green: "\x1b[92m",
    yellow: "\x1b[93m",
    red: "\x1b[91m",
    gray: "\x1b[90m",
    white: "\x1b[97m",
    blue: "\x1b[94m",
    /**
     * Generates a terminal escape code moving the cursor vertically upward.
     */
    up: (n: number) => (n > 0 ? `\x1b[${n}A` : ""),
    /**
     * Generates a terminal escape code moving the cursor horizontally forward.
     */
    right: (n: number) => (n > 0 ? `\x1b[${n}C` : ""),
    /**
     * Generates a terminal escape code moving the cursor horizontally backward.
     */
    left: (n: number) => (n > 0 ? `\x1b[${n}D` : ""),
} as const;

/**
 * Standard mapping collection identifying specialized input stream key sequences.
 * * @public
 */
export const KEYS = {
    ctrlC: "\x03",
    ctrlD: "\x04",
    ctrlU: "\x15",
    ctrlA: "\x01",
    ctrlV: "\x16",
    altC: "\x1bc",
    altC2: "\x1bC",
    altV: "\x1bv",
    altV2: "\x1bV",
    ctrlShiftC: "\x1b\x03",
    escape: "\x1b",
    enter: "\r",
    backspace: "\x7f",
    tab: "\t",
    space: " ",
    arrowRight: "\x1b[C",
    arrowUp: "\x1b[A",
    arrowDown: "\x1b[B",
    arrowLeft: "\x1b[D",
    shiftLeft: "\x1b[1;2D",
    shiftRight: "\x1b[1;2C",
    ctrlBackspace: "\x08",
} as const;

/**
 * Decorates a string sequence with a targeted ANSI formatting prefix color and clear reset code.
 *
 * @param col - Target ANSI color configuration code snippet.
 * @param s - Target textual payload contents to transform.
 * @returns Formatted colored string.
 * * @public
 */
export const format = (col: string, s: string): string => `${col}${s}${COLORS.reset}`;

/**
 * Removes all embedded ANSI terminal color format escape codes from a text segment.
 *
 * @param s - Input string containing color tags.
 * @returns Clean raw plaintext contents.
 * * @public
 */
export const strip = (s: string): string => s.replaceAll(/\x1b\[[0-9;]*m/g, "");

/**
 * Halts pipeline execution workflows for a designated duration span.
 *
 * @param ms - Absolute milliseconds duration boundary to wait.
 * @returns A microtask promise monitoring resolution.
 * * @public
 */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
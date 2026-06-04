import { Registry } from "../registry.js";
import { type CommandInternal, type ArgDefinition } from "../types.js";
import { COLORS, format } from "./ansi.js";
import fsimport from "node:fs";
import pathimport from "node:path";

const JS_KEYWORDS = [
    "const", "let", "var", "return", "if", "else", "for", "while", "function",
    "class", "new", "await", "async", "typeof", "instanceof", "import", "export",
    "default", "switch", "case", "break", "continue", "try", "catch", "finally",
    "throw", "delete", "void", "yield", "of", "in", "true", "false", "null",
    "undefined", "this", "super",
];

/**
 * Traverses a segmented phrase chain down hierarchical branch namespaces.
 *
 * @param parts - Ordered list segments indicating current structural traversal route paths.
 * @param registry - The starting parent execution registry tree boundary.
 * @returns Nested target lookup container references alongside calculated traversal depth counts.
 * * @public
 */
export function walkNS(parts: string[], registry: Registry): { reg: Registry; depth: number } {
    let reg = registry, depth = 0;
    while (depth < parts.length - 1) {
        const cmd = reg.get(parts[depth]!);
        if (cmd?.commands) {
            reg = cmd.commands;
            depth++;
        } else break;
    }
    return { reg, depth };
}

/**
 * Scans, processes, and extracts eligible auto-complete string arrays based on input strings.
 *
 * @param input - Current console layout string values.
 * @param registry - Master route mapping configuration layer.
 * @param context - Mutational shared analytical context space variables.
 * @param globals - Framework tools mapping container records.
 * @returns Filtered matched suggestion phrases.
 * * @public
 */
export function getCandidates(input: string, registry: Registry, context: any, globals: any): string[] {
    const trailing = input.endsWith(" ");
    const parts = input.trim().split(/\s+/).filter(Boolean);
    
    if (!parts.length) {
        return registry.names();
    }

    let reg = registry;
    let depth = 0;
    while (depth < parts.length - 1) {
        const cmd = reg.get(parts[depth]!);
        if (cmd?.commands) {
            reg = cmd.commands;
            depth++;
        } else {
            break;
        }
    }

    const currentToken = parts[depth]!;
    const cmd = reg.get(currentToken);

    if (cmd && cmd.commands && trailing) {
        return cmd.commands.names();
    }

    if (!cmd || (cmd.commands && !trailing)) {
        const searchWord = cmd?.commands && !trailing ? currentToken : parts[parts.length - 1]!;
        return reg.names().filter(name => name.startsWith(searchWord));
    }

    const cmdArgsTokens = parts.slice(depth + 1);
    const currentWord = trailing ? "" : (cmdArgsTokens[cmdArgsTokens.length - 1] ?? "");

    if (!cmd || (cmd.commands && !trailing) || (depth === parts.length - 1 && !trailing)) {
        const searchWord = (cmd?.commands && !trailing) ? currentToken : parts[parts.length - 1]!;
        return reg.names().filter(name => name.startsWith(searchWord));
    }

    const optToken = trailing 
        ? cmdArgsTokens[cmdArgsTokens.length - 1] 
        : cmdArgsTokens[cmdArgsTokens.length - 2];

    if (optToken && optToken.startsWith("-")) {
        const cleanOpt = optToken.replace(/^--?/, "");
        const targetOpt = cmd.options?.find(o => o.name === cleanOpt || o.short === cleanOpt);
        
        if (targetOpt && targetOpt.choices) {
            const choices = typeof targetOpt.choices === "function"
                ? targetOpt.choices(currentWord, cmdArgsTokens, context, globals)
                : targetOpt.choices;
            return (choices || []).filter(c => c.startsWith(currentWord));
        }
    }

    const usedOptions = new Set<string>();
    const tokensToProcess = trailing ? cmdArgsTokens : cmdArgsTokens.slice(0, -1);
    
    for (const token of tokensToProcess) {
        if (token.startsWith("-")) {
            const clean = token.replace(/^--?/, "");
            const opt = cmd.options?.find(o => o.name === clean || o.short === clean);
            if (opt) {
                usedOptions.add(opt.name);
            }
        }
    }

    const optionCandidates: string[] = [];
    if (cmd.options) {
        for (const opt of cmd.options) {
            if (usedOptions.has(opt.name)) continue;
            if (opt.name) optionCandidates.push(`--${opt.name}`);
            if (opt.short) optionCandidates.push(`-${opt.short}`);
        }
    }

    const positionalArgsTyped: string[] = [];
    let i = 0;
    const upperLimit = trailing ? cmdArgsTokens.length : cmdArgsTokens.length - 1;
    
    while (i < upperLimit) {
        const token = cmdArgsTokens[i]!;
        if (token.startsWith("-")) {
            const clean = token.replace(/^--?/, "");
            const opt = cmd.options?.find(o => o.name === clean || o.short === clean);
            if (opt && (opt.type === "string" || opt.choices)) {
                i += 2;
            } else {
                i += 1;
            }
        } else {
            positionalArgsTyped.push(token);
            i += 1;
        }
    }
    const currentArgIndex = positionalArgsTyped.length;

    let positionalCandidates: string[] = [];
    if (cmd.args && cmd.args[currentArgIndex]) {
        const argDef = cmd.args[currentArgIndex]!;
        if (argDef.choices) {
            positionalCandidates = typeof argDef.choices === "function"
                ? argDef.choices(currentWord, positionalArgsTyped, context, globals)
                : argDef.choices;
        }
    }

    const allCandidates = [...positionalCandidates, ...optionCandidates];
    return allCandidates.filter(c => c.startsWith(currentWord));
}

/**
 * Identifies and isolates missing arguments definitions remaining to satisfy commands.
 *
 * @param input - Active prompt text line layout.
 * @param registry - Root lookup configuration map structures.
 * @returns Array collection containing tail parameter definitions.
 * * @public
 */
export function getHintArgs(input: string, registry: Registry): ArgDefinition[] {
    const trailing = input.endsWith(" ");
    const parts = input.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return [];

    const { reg, depth } = walkNS(parts, registry);
    const cmd = reg.get(parts[depth]!);
    if (!cmd) return [];

    let target = cmd, argOffset = depth + 1;
    if (cmd.commands) {
        const sub = parts[depth + 1] ? (cmd.commands as Registry).get(parts[depth + 1]!) : null;
        if (!sub) return [];
        target = sub;
        argOffset = depth + 2;
    }

    const filled = parts.slice(argOffset).length;
    const pos = trailing ? filled : Math.max(0, filled - 1);
    return target.args.slice(pos + 1);
}

/**
 * Extracts the final contiguous word segment token from an input text sequence line.
 *
 * @param input - The text stream buffer content.
 * @returns Isolated active phrase slice or empty string.
 * * @public
 */
export function currentWord(input: string): string {
    return input.endsWith(" ") ? "" : (input.split(/\s+/).at(-1) ?? "");
}

/**
 * Inspects isolated VM object models to compute predictive JavaScript property keys.
 *
 * @param input - The active script code phrase segment.
 * @param sandboxRoot - Activated proxy model monitoring local variables.
 * @returns Matching candidates properties alongside targeted modification span lengths.
 * * @public
 */
export function getJSCandidates(input: string, sandboxRoot: any): { candidates: string[]; replaceLen: number } {
    const chainMatch = input.match(/([\w$][\w$.]*)\.(\w*)$/);
    if (chainMatch) {
        const chain = chainMatch[1]!.split(".");
        const partial = chainMatch[2]!;

        let obj = sandboxRoot;
        for (const key of chain) {
            if (obj == null || (typeof obj !== "object" && typeof obj !== "function")) {
                return { candidates: [], replaceLen: 0 };
            }
            obj = obj[key];
        }
        if (obj == null) return { candidates: [], replaceLen: 0 };

        const proto = Object.getPrototypeOf(obj);
        const keys = [
            ...Object.getOwnPropertyNames(obj),
            ...(proto && proto !== Object.prototype ? Object.getOwnPropertyNames(proto) : []),
        ].filter((k) => !k.startsWith("_") && !k.startsWith("#") && k !== "constructor");

        const candidates = [...new Set(keys)].filter((k) => k.startsWith(partial)).sort();
        return { candidates, replaceLen: partial.length };
    }

    const topMatch = input.match(/([\w$]+)$/);
    if (!topMatch) return { candidates: [], replaceLen: 0 };

    const partial = topMatch[1]!;
    const sandboxKeys = Object.keys(sandboxRoot);
    const candidates = [...new Set([...sandboxKeys, ...JS_KEYWORDS])]
        .filter((k) => k.startsWith(partial) && k !== partial)
        .sort();
    return { candidates, replaceLen: partial.length };
}

/**
 * Tokenizes, checks syntax paths, and colorizes input lines with full ANSI tags.
 *
 * @param input - The plain string line contents.
 * @param registry - Active hierarchical navigation dictionary mappings.
 * @param jsMode - Flags if JavaScript lexical rules overwrite normal arguments tokens.
 * @param context - Stateful parameter variables map.
 * @param globals - Embedded application environmental global tools.
 * @returns Complete colorized text safe for active terminal standard output writers.
 * @public
 */
export function colorInput(input: string, registry: Registry, jsMode: boolean, context: any, globals: any): string {
    if (jsMode) return colorJS(input);

    const tokens = input.split(/(\s+)/).filter(Boolean);
    
    const words = tokens.filter(t => !/^\s+$/.test(t));
    if (!words.length) return input;

    const { reg, depth } = walkNS(words, registry);
    const coloredWords: string[] = new Array(words.length);
    const trailing = input.endsWith(" ");

    for (let i = 0; i < depth; i++) {
        coloredWords[i] = format(COLORS.cyan + COLORS.bold, words[i]!);
    }

    const rawName = words[depth]!;
    const cmd = reg.get(rawName);
    const typingCmd = depth === words.length - 1 && !trailing;

    if (typingCmd) {
        coloredWords[depth] = format(COLORS.white + COLORS.bold, rawName);
    } else if (cmd) {
        coloredWords[depth] = format(COLORS.cyan + COLORS.bold, rawName);
    } else {
        coloredWords[depth] = format(COLORS.red, rawName);
    }

    if (!cmd || typingCmd) {
        for (let i = depth + 1; i < words.length; i++) {
            coloredWords[i] = format(COLORS.white, words[i]!);
        }
    } else {
        let target = cmd;
        let argOffset = depth + 1;

        if (cmd.commands && words.length > depth + 1) {
            const subRaw = words[depth + 1]!;
            const sub = (cmd.commands as Registry).get(subRaw);
            const typingSub = words.length === depth + 2 && !trailing;

            if (typingSub) {
                coloredWords[depth + 1] = format(COLORS.white + COLORS.bold, subRaw);
            } else if (sub) {
                coloredWords[depth + 1] = format(COLORS.blue + COLORS.bold, subRaw);
            } else {
                coloredWords[depth + 1] = format(COLORS.red, subRaw);
            }

            if (!sub || typingSub) {
                for (let i = depth + 2; i < words.length; i++) {
                    coloredWords[i] = format(COLORS.white, words[i]!);
                }
            } else {
                target = sub;
                argOffset = depth + 2;
                processArgs(target, argOffset);
            }
        } else {
            processArgs(target, argOffset);
        }
    }

    function processArgs(currentTarget: any, offset: number) {
        const argsWords = words.slice(offset);
        argsWords.forEach((token, i) => {
            const wordIdx = offset + i;
            const def = currentTarget.args[i];
            if (!def) {
                coloredWords[wordIdx] = format(COLORS.white, token);
                return;
            }
            if (def.choices) {
                const previousArgs = words.slice(offset, offset + i);
                const list = typeof def.choices === "function"
                    ? def.choices(token, previousArgs, context, globals)
                    : def.choices;
                if (list.includes(token) || list.some((c: string) => c.startsWith(token))) {
                    coloredWords[wordIdx] = format(COLORS.yellow, token);
                } else {
                    coloredWords[wordIdx] = format(COLORS.red + COLORS.bold, token);
                }
            } else {
                coloredWords[wordIdx] = format(COLORS.white, token);
            }
        });
    }

    let result = "";
    let wordCounter = 0;

    for (const token of tokens) {
        if (/^\s+$/.test(token)) {
            result += token;
        } else {
            result += coloredWords[wordCounter++];
        }
    }

    return result;
}

/**
 * Colorizes standard JavaScript syntax keywords, structures, and strings.
 */
function colorJS(input: string): string {
    const tokenRegex = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:const|let|var|return|if|else|for|while|function|class|new|await|async|typeof|instanceof)\b)|(\b\d+\.?\d*\b)/g;
    return input.replace(tokenRegex, (match, stringToken, keywordToken, numberToken) => {
        if (stringToken) return format(COLORS.green, stringToken);
        if (keywordToken) return format(COLORS.blue + COLORS.bold, keywordToken);
        if (numberToken) return format(COLORS.yellow, numberToken);
        return match;
    });
}

/**
 * Asserts structural grammar validation, verifying sub-namespaces and ensuring all required parameters are specified.
 *
 * @param input - The raw statement line string intended for execution.
 * @param registry - Hierarchical routing definitions tree.
 * @returns Status validation diagnostic object.
 * * @public
 */
export function validate(input: string, registry: Registry): { ok: boolean; unknownCmd?: string; needsSubcmd?: boolean; name?: string; missingArgs?: string[] } {
    const parts = input.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { ok: true };

    const { reg, depth } = walkNS(parts, registry);
    const cmd = reg.get(parts[depth]!);
    if (!cmd) return { ok: false, unknownCmd: parts[depth] };

    let target = cmd, argOffset = depth + 1;
    if (cmd.commands) {
        const sub = parts[depth + 1] ? (cmd.commands as Registry).get(parts[depth + 1]!) : null;
        if (!sub) return { ok: false, needsSubcmd: true, name: cmd.name };
        target = sub;
        argOffset = depth + 2;
    }

    const provided = parts.slice(argOffset).length;
    const missing = target.args
        .filter((a, i) => a.required && i >= provided)
        .map((a) => a.name);
    return { ok: missing.length === 0, missingArgs: missing };
}

/**
 * High-performance file path completion builder mapping real directory systems onto option choices.
 *
 * @remarks
 * Dynamically resolves slash trends across platforms, queries synchronous local filesystem boundaries, 
 * filters trailing types, and appends directory directory context indicators.
 *
 * @param options - Toggles adjusting directory searches.
 * @returns A structured contextual choice generator function compliant with `ArgDefinition["choices"]`.
 * * @public
 */
export function pathCompleter(options: { onlyDirs?: boolean } = {}): (typed: string, previousArgs: string[], context: any, globals: any) => string[] {
    return (typed: string, previousArgs: string[], context: any, globals: any): string[] => {
        const fs = globals.fs || fsimport;
        const path = globals.path || pathimport;
        
        const normalized = typed.replace(/\\/g, "/");
        let searchDir = ".";
        let baseName = normalized;

        if (normalized.includes("/")) {
            const lastSlash = normalized.lastIndexOf("/");
            searchDir = normalized.slice(0, lastSlash);
            baseName = normalized.slice(lastSlash + 1);
            if (searchDir === "") searchDir = "/";
        }

        try {
            if (!fs.existsSync(searchDir) || !fs.statSync(searchDir).isDirectory()) return [];
            const items = fs.readdirSync(searchDir);
            const results: string[] = [];

            for (const item of items) {
                if (item.startsWith(".") && !baseName.startsWith(".")) continue;
                const fullPath = searchDir === "." ? item : `${searchDir}/${item}`;
                
                let isDir = false;
                try { isDir = fs.statSync(fullPath).isDirectory(); } catch {}
                if (options.onlyDirs && !isDir) continue;

                results.push(isDir ? `${fullPath}/` : fullPath);
            }
            return results;
        } catch {
            return [];
        }
    };
}

export function getLevenshteinDistance(a: string, b: string): number {
    const matrix: any[] = Array.from({ length: a.length + 1 }, () => []);
    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
    }
    return matrix[a.length]![b.length]!;
}
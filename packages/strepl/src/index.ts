/**
 * High-performance interactive Read-Eval-Print Loop (REPL) and custom execution shell engine.
 *
 * @remarks
 * Provides a modular infrastructure for constructing command-line terminal applications. Features 
 * advanced sub-namespace resolution, context-aware command auto-completion pipelines, safe isolated 
 * sandboxed execution layers, and multi-line buffer history managers with dynamic console UI overlays.
 *
 * @packageDocumentation
 */

export * from "./types.js";
export * from "./registry.js";
export * from "./repl.js";
export * from "./renderer.js";
export * from "./sandbox.js";
export * from "./utils/ansi.js";
export * from "./utils/completion.js";
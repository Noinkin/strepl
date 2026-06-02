import vm from "node:vm";
import util from "node:util";

const DECLARE = /(?:^|;|\n)\s*(?:const|let|var|function\*?|class)\s+([$\w]+)/g;

/**
 * Isolated sandboxed evaluation scope running calculations via core V8 VM contexts.
 *
 * @remarks
 * Restricts top-level leakage, injects explicit console/asynchronous tools safely, and handles top-level 
 * await syntax rewrites gracefully with short timeout thresholds.
 *
 * @public
 */
export class JSSandbox {
    #vmCtx: vm.Context;
    #declared = new Set<string>();

    /**
     * Instantiates an isolated execution context box layer.
     *
     * @param context - Reference container shared mapping internal states.
     * @param globals - Toolkits and dependency properties injected directly for runtime lookups.
     */
    constructor(context: Record<string, any>, globals: Record<string, any>) {
        const builtins = {
            console, process,
            setTimeout, setInterval, clearTimeout, clearInterval,
            Promise, JSON, Math, Date, Array, Object, String, Number, Boolean,
            Map, Set, WeakMap, WeakSet, Error, RegExp, Symbol, Proxy, Reflect,
            parseInt: Number.parseInt, parseFloat: Number.parseFloat, isNaN: Number.isNaN, isFinite: Number.isFinite, encodeURIComponent, decodeURIComponent,
        };
        this.#vmCtx = vm.createContext({ context, globals, ...globals, ...builtins });
    }

    /**
     * Resolves an proxy interface managing root context lookups and state bindings.
     *
     * @remarks
     * Dynamically exposes explicitly declared top-level script statements as properties.
     */
    get root(): any {
        const declared: Record<string, boolean> = {};
        for (const name of this.#declared) declared[name] = true;
        return new Proxy(this.#vmCtx, {
            ownKeys: (target) => [
                ...new Set([...Reflect.ownKeys(target) as string[], ...this.#declared]),
            ],
            getOwnPropertyDescriptor: (target, key) => ({
                configurable: true, enumerable: true,
                value: target[key as string] ?? declared[key as string],
            }),
        });
    }

    /**
     * Process, intercepts, converts and safely runs raw string scripts against internal V8 VM layers.
     *
     * @param code - The string expression or statement sequence script to parse and execute.
     * @returns Inspected formatted data string representation, or `null` if resolution provides no value.
     */
    async eval(code: string): Promise<string | null> {
        for (const m of code.matchAll(DECLARE)) {
            if (m[1]) this.#declared.add(m[1]);
        }

        if (!/\bawait\b/.test(code)) {
            const result = vm.runInContext(code, this.#vmCtx, { timeout: 5000 });
            if (result === undefined) return null;
            return util.inspect(result, { depth: 4, colors: true });
        }

        const asyncCode = code.replaceAll(
            /\b(?:const|let|var)\s+([$\w]+)\s*=/g,
            (_, name) => `globalThis.${name} =`
        );

        let promise: Promise<any>;
        try {
            promise = vm.runInContext(`(async () => (${asyncCode}))()`, this.#vmCtx);
        } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
            promise = vm.runInContext(`(async () => { ${asyncCode} })()`, this.#vmCtx);
        }

        const result = await Promise.race([
            promise,
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Timed out after 5s")), 5000)
            ),
        ]);

        if (result === undefined) return null;
        return util.inspect(result, { depth: 4, colors: true });
    }
}
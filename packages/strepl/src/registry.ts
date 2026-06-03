import { type CommandDefinition, type CommandInternal } from "./types.js";

/**
 * Core command resolution hierarchical routing dictionary structure.
 *
 * @remarks
 * Maintains an internal identifier mapping of lookup keys, primary names, and input command definitions 
 * enabling recursive execution and token lookups.
 *
 * @public
 */
export class Registry {
    /**
     * Internal string map index capturing token paths and routing references.
     */
    #map = new Map<string, CommandInternal>();

    /**
     * Registers a new command schema pattern or a sub-namespace index node tree under this router.
     *
     * @param def - The command target configuration schema structure.
     * @returns The contextual registry instance enabling fluent operational composition.
     */
    add(def: CommandDefinition): this {
        const hasSubcommands = 'commands' in def && !!def.commands?.length;
        const sub = hasSubcommands ? new Registry() : null;
        
        if (sub && 'commands' in def && def.commands) {
            for (const c of def.commands) sub.add(c);
        }

        const cmd: CommandInternal = {
            name: def.name,
            aliases: def.aliases ?? [],
            description: def.description ?? "",
            args: ('args' in def ? def.args : []) ?? [],
            options: ('options' in def ? def.options : []) ?? [],
            commands: sub,
            run: ('run' in def ? def.run : null) ?? null,
        };

        this.#map.set(cmd.name, cmd);
        for (const a of cmd.aliases) this.#map.set(a, cmd);
        return this;
    }

    /**
     * Performs a direct match retrieval for a registered item by primary key name or structural alias.
     *
     * @param n - The query phrase matching command string identifiers.
     * @returns The matching object metadata model, or `undefined` if none is found.
     */
    get(n: string): CommandInternal | undefined {
        return this.#map.get(n);
    }

    /**
     * Extracts an array sequence containing all operational match labels, including all aliases.
     *
     * @returns Complete structural collection list representing all accessible entry keys.
     */
    names(): string[] {
        return [...this.#map.keys()];
    }

    /**
     * Assembles a collection containing all distinct command structures stored under this map layer.
     *
     * @remarks
     * Filters out duplicate structural entries mapped via aliases, supplying unique instances.
     *
     * @returns An array containing unique internal command models.
     */
    all(): CommandInternal[] {
        const seen = new Set<string>();
        return [...this.#map.values()].filter(
            (c) => !seen.has(c.name) && seen.add(c.name),
        );
    }
}
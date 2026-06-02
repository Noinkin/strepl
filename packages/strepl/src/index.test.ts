import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Repl, arg, pathCompleter } from "./index.js";

interface AppPreferences {
    theme: "dark" | "light" | "cyberpunk";
    telemetry: boolean;
}

interface AppContext {
    user: string | null;
    loggedIn: boolean;
    preferences: AppPreferences;
    db: Record<string, string[]>;
    metrics: {
        totalCommandsRun: number;
        lastCommandDurationMs: number;
    };
    _executionTimer?: [number, number];
}

interface AppGlobals {
    fs: typeof fs;
    path: typeof path;
    os: typeof os;
    crypto: typeof crypto;
}

const repl = new Repl({
    context: {
        user: null,
        loggedIn: false,
        preferences: {
            theme: "dark",
            telemetry: true,
        },
        db: {
            users: ["admin", "guest"],
            logs: ["system_boot", "init_success"],
        },
        metrics: {
            totalCommandsRun: 0,
            lastCommandDurationMs: 0,
        },
    } as AppContext,
    globals: { fs, path, os, crypto } as AppGlobals,
});

repl
    .before(async (raw: string, context: AppContext) => {
        const openCommands = ["login", "help", "exit", "js", "clear", "?", "quit"];
        const primaryCommand = raw.trim().split(/\s+/)[0] ?? "";
        
        if (!context.loggedIn && !openCommands.includes(primaryCommand)) {
            throw new Error(`Authentication Required. Run: login <user>`);
        }

        context._executionTimer = process.hrtime();
    })
    .after(async (raw: string, context: AppContext) => {
        context.metrics.totalCommandsRun++;

        if (context._executionTimer && context.preferences.telemetry) {
            const diff = process.hrtime(context._executionTimer);
            const durationMs = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
            context.metrics.lastCommandDurationMs = parseFloat(durationMs);
            
            process.stdout.write(
                `  \x1b[90m⏱ Telemetry: "${raw.trim()}" finished in ${durationMs}ms [Total Run Count: ${context.metrics.totalCommandsRun}]\x1b[0m\n`
            );
        }
    });

repl.command({
    name: "login",
    description: "Authenticate active session profile",
    args: [arg("user", { choices: ["root", "operator", "engineer"] })],
    run([user], context: AppContext) {
        if (!user) return;
        context.loggedIn = true;
        context.user = user;
        process.stdout.write(`  \x1b[92m✔ Access Granted.\x1b[0m Active Identity: \x1b[1m${user}\x1b[0m\n`);
    },
});

repl.command({
    name: "fs",
    description: "Advanced context-aware filesystem navigation shell",
    commands: [
        {
            name: "cd",
            description: "Traverse directories (Autocompletes folders only)",
            args: [
                arg("path", { 
                    choices: pathCompleter({ onlyDirs: true }) 
                })
            ],
            run([targetPath]) {
                if (!targetPath) return;
                try {
                    process.chdir(targetPath);
                    process.stdout.write(`  \x1b[92m✔ Dir changed:\x1b[0m ${process.cwd()}\n`);
                } catch (e: any) {
                    process.stdout.write(`  \x1b[91m✗ Navigation error: ${e.message}\x1b[0m\n`);
                }
            }
        },
        {
            name: "cat",
            description: "Print text file layouts (Autocompletes folders and file items)",
            args: [
                arg("file_path", {
                    choices: pathCompleter() 
                })
            ],
            run([filePath], _, globals) {
                if (!filePath) return;
                try {
                    const text = globals.fs.readFileSync(filePath, "utf8");
                    process.stdout.write(`\n\x1b[90m--- FILE STREAM OUT ---\x1b[0m\n${text}\n`);
                } catch {
                    process.stdout.write(`  \x1b[91m✗ Cannot display resource at path target.\x1b[0m\n`);
                }
            }
        }
    ]
});

repl.command({
    name: "db",
    description: "Contextual runtime storage array management engine",
    commands: [
        {
            name: "collection",
            description: "Provision a brand new collection space into session state memory",
            args: [arg("name")],
            run([name], context: AppContext) {
                if (!name) return;
                if (context.db[name]) {
                    process.stdout.write(`  \x1b[93m⚠ Collection "${name}" already initialized.\x1b[0m\n`);
                    return;
                }
                context.db[name] = [];
                process.stdout.write(`  \x1b[92m✔ provisioned memory bucket registry:\x1b[0m db.${name}\n`);
            }
        },
        {
            name: "insert",
            description: "Append structural item row to specified collection data map pool",
            args: [
                arg("target_collection", { choices: () => Object.keys(repl.context.db) }),
                arg("entry_value")
            ],
            run([target, value], context: AppContext) {
                if (!target || !value) return;
                if (!context.db[target]) {
                    process.stdout.write(`  \x1b[91m✗ Error:\x1b[0m Collection "${target}" does not exist.\n`);
                    return;
                }
                context.db[target].push(value);
                process.stdout.write(`  \x1b[92m✔ Document committed:\x1b[0m inserted into "${target}" [Size: ${context.db[target].length}]\n`);
            }
        },
        {
            name: "query",
            description: "Dump runtime array maps from live state memory allocation schema",
            args: [arg("collection_name", { choices: () => Object.keys(repl.context.db) })],
            run([collectionName], context: AppContext) {
                if (!collectionName) return;
                const target = context.db[collectionName];
                if (!target) {
                    process.stdout.write(`  \x1b[91m✗ Unknown Target Map Index Selection.\x1b[0m\n`);
                    return;
                }
                process.stdout.write(`  \x1b[36m⚡ db.${collectionName} records:\x1b[0m ${JSON.stringify(target, null, 2)}\n`);
            }
        }
    ]
});

repl.command({
    name: "config",
    description: "Alter framework terminal variables runtime context parameters",
    commands: [
        {
            name: "set",
            description: "Modify target parameter runtime mapping value keys",
            args: [
                arg("parameter", { choices: ["theme", "telemetry"] }),
                arg("value", { choices: ["dark", "light", "cyberpunk", "true", "false"] })
            ],
            run([param, val], context: AppContext) {
                if (!param || !val) return;
                if (param === "theme") {
                    context.preferences.theme = val as any;
                } else if (param === "telemetry") {
                    context.preferences.telemetry = val === "true";
                }
                process.stdout.write(`  \x1b[92m✔ Updated configuration assignment:\x1b[0m context.preferences.${param} = ${val}\n`);
            }
        },
        {
            name: "status",
            description: "Audit existing operational profile variables matrix",
            run(_, context: AppContext) {
                process.stdout.write(`\n  \x1b[1mFramework State Audit:\x1b[0m\n`);
                process.stdout.write(`    • Active Session Key: \x1b[33m${context.user}\x1b[0m\n`);
                process.stdout.write(`    • Target Theme Layout: \x1b[36m${context.preferences.theme}\x1b[0m\n`);
                process.stdout.write(`    • Realtime Telemetry Hook: \x1b[35m${context.preferences.telemetry}\x1b[0m\n`);
                process.stdout.write(`    • Allocated Memory Buckets: \x1b[32m${Object.keys(context.db).join(", ")}\x1b[0m\n\n`);
            }
        }
    ]
});

repl.command({
    name: "crypto",
    description: "Cryptographic state verification systems tooling integration pipeline",
    commands: [
        {
            name: "hash",
            description: "Compute secure cryptographic message digest verification check signatures",
            args: [
                arg("algorithm", { choices: ["sha256", "md5", "sha512"] }),
                arg("payload_text")
            ],
            run([algo, text], _, globals: AppGlobals) {
                if (!algo || !text) return;
                try {
                    const hashed = globals.crypto.createHash(algo).update(text).digest("hex");
                    process.stdout.write(`  \x1b[96m⚙ Hash [${algo.toUpperCase()}]:\x1b[0m ${hashed}\n`);
                } catch (e: any) {
                    process.stdout.write(`  \x1b[91m✗ Crypto Engine Failure: ${e.message}\x1b[0m\n`);
                }
            }
        }
    ]
});

repl.command({
    name: "system",
    description: "Host platform operational profiling monitoring diagnostics suite",
    commands: [
        {
            name: "hardware",
            description: "Output architecture configuration specifics of runtime engine sandbox",
            run(_, __, globals: AppGlobals) {
                process.stdout.write(`\n  \x1b[1mHost Infrastructure Core Metrics:\x1b[0m\n`);
                process.stdout.write(`    Platform System Type: \x1b[33m${globals.os.platform()} (${globals.os.arch()})\x1b[0m\n`);
                process.stdout.write(`    Process Exec Uptime : \x1b[36m${globals.os.uptime()} seconds\x1b[0m\n`);
                process.stdout.write(`    CPU Matrix Load     : \x1b[32m${globals.os.cpus().length} threads concurrent\x1b[0m\n\n`);
            }
        }
    ]
});

repl.start();
# stREPL

A high-performance, developer-first orchestration framework for engineering advanced interactive command-line terminals, custom execution shells, and Read-Eval-Print Loops (REPL) inside Node.js applications.

Designed specifically for building powerful developer toolkits, specialized databases, embedded runtimes, and local administrative interfaces.

## Key Architectural Capabilities

* **Hierarchical Command Directories:** Construct deeply-nested command namespaces and leaf-execution architectures using clear, declarative definition blueprints.
* **Context-Aware Completion Pipeline:** Dynamically generate smart auto-complete overlays with fluid tab transitions. Leverages static lists or live evaluation callbacks reading contextual state.
* **Isolated JS VM Playground:** Shift instantaneously into a sandboxed V8 JavaScript runtime environment. Ships complete with top-level `await` handling, state persistence proxies, and built-in 5-second execution timeout protections.
* **Advanced UI Repaint Core:** Fully-custom ANSI terminal display overlay supporting scrollable scroll-window menus for overflowing selection items, caret micro-movements, input error flash accents, and multiline statements via trailing escape slashes (`\`).
* **Rich Interaction Paradigms:** Native clipboard integration (`Alt+C` / `Alt+V`) paired with character block highlight selections utilizing `Shift + Arrow` keyboard interactions directly inside a raw terminal window.
* **Lifecycle Pipeline Middleware:** Inject chainable asynchronous interception hooks (`before` / `after`) to implement runtime validations, auditing layers, or metrics monitoring around command processing loops.

---

## Installation

```bash
npm install streplts

```

---

## Quick Start Guide

Instantiate a robust interactive console shell with multi-tiered commands and parameter completion constraints in just a few lines of code:

```typescript
import { Repl, arg, pathCompleter } from 'streplts';

// 1. Initialize the engine with custom operational memory and tools
const shell = new Repl({
  context: {
    user: 'admin',
    connected: true
  },
  globals: {
    logger: console,
    fs: require('node:fs'),
    path: require('node:path')
  }
});

// 2. Attach an execution leaf with specific argument requirements
shell.command({
  name: 'config',
  description: 'Manage active operational application profiles',
  args: [
    arg('action', { 
      required: true, 
      choices: ['view', 'update', 'reset'] 
    }),
    arg('profile', { 
      required: false, 
      choices: ['development', 'production', 'staging'] 
    })
  ],
  run: async ([action, profile], context) => {
    console.log(`\nExecuting action "${action}" across target profile context: ${profile ?? 'default'}`);
    context.lastAction = action;
  }
});

// 3. Chain a secondary command attaching a dynamic path discovery helper
shell.command({
  name: 'import',
  description: 'Ingest data files from local storage structures',
  args: [
    arg('targetFile', {
      required: true,
      choices: pathCompleter({ onlyDirs: false }) // Live path suggestions
    })
  ],
  run: ([targetFile]) => {
    console.log(`\nIngesting structural source content tracking path: ${targetFile}`);
  }
});

// 4. Spin up key event hooks and establish raw console streaming loop conditions
shell.start();

```

---

## Deep Architectural Concepts

### Nested Sub-Namespaces

Group structural system workflows under clear domains by providing nested command child arrays. The resolution layer recursively traces pathways smoothly:

```typescript
shell.command({
  name: 'system',
  description: 'Root environment administrative parameters container',
  commands: [
    {
      name: 'status',
      description: 'Display host machine performance metrics',
      run: () => console.log('\nAll core subsystems functioning within nominal limits.')
    },
    {
      name: 'restart',
      description: 'Power-cycle cluster deployment nodes',
      args: [arg('nodeId', { required: true })],
      run: ([id]) => console.log(`\nInitiating safe reboot cycle across cluster partition ${id}`)
    }
  ]
});

```

### Advanced Middleware Hook Pipelines

Affix chainable runtime interception tasks to handle security parameters, parse permissions, or inject analytical tracking logic around target runs:

```typescript
shell
  .before(async (raw, context) => {
    if (context.user !== 'admin') {
      throw new Error("Security Violation: Insufficient administrative clearances.");
    }
  })
  .after(async (raw) => {
    // Fired cleanly whenever execution sequences conclude successfully
    this.globals.logger.info(`Auditing execution string: "${raw}"`);
  });

```

### The Isolated Sandboxed JavaScript Shell

Typing `js` inside the terminal window immediately redirects the interface into an isolated V8 execution context block layer.

* State adjustments within the environment proxy definitions back onto your `context` mapping block.
* Standard console formatting rules apply using explicit recursive depths via V8 inspection metrics.
* Type `exit` or strike the `Escape` key sequence to fall cleanly back to standard command processing configurations.

---

## Control Interface Bindings

| Input Gesture | Core Operational Functionality Mapping |
| --- | --- |
| **Tab** | Accepts the active faint ghost autocomplete selection prediction. |
| **Up / Down Arrows** | Traverses visible overflow scroll-dropdown suggestions. Alternates to command input history indexing if no list exists. |
| **Shift + Left / Right** | Highlights range segments creating an explicit text selection block. |
| **Alt + C** | Copies the highlighted text selection (or whole line if empty) straight to system clipboards. |
| **Alt + V / Ctrl + V** | Seamlessly pulls plaintext records from the clipboard into current cursor offsets. |
| **Ctrl + U** | Wipes the entire current terminal workspace prompt line instantaneously. |
| **Escape** | Toggles operation modes instantly between standard Commands and the JS VM Sandbox. |
| **\ (Trailing End)** | Postpones completion evaluation loops, breaking statements across clean multi-line block spaces. |
| **Ctrl + C / Ctrl + D** | Closes raw streaming descriptors and shuts down the core execution context frame safely. |

---

## License

Apache 2.0
# Haibun VS Code Extension

Autocomplete and hover for `.feature` files based on your project's steppers.

## Quick Start

```bash
# 1. Build the LSP server
npm run build:tsc

# 2. Install extension deps
cd vscode-extension && npm install && npm run compile

# 3. Press F5 to launch
```

## Configuration

The extension reads `lsp-server/config.json` to know which steppers provide autocomplete:

```json
{
  "steppers": [
    "@haibun/web-playwright/build/web-playwright",
    "@haibun/storage-fs/build/storage-fs",  
    "variables-stepper",
    "haibun"
  ]
}
```

**This is the same format as your haibun config files.** Add your project's steppers here.

## How It Works

1. `lsp-server.ts` loads the steppers listed in config
2. `StepperRegistry.getMetadata()` extracts available steps
3. VS Code sends completion requests → LSP returns matching steps

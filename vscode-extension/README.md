# Haibun VS Code Extension

Provides autocomplete and hover documentation for `.feature` files by dynamically loading your project's steppers.

## How It Works

The extension launches a Language Server that reads a `lsp-server/config.json` file in your workspace root. This configuration tells the server exactly which steppers (whether npm packages or local files) to load, ensuring that the features you see match your specific project environment.

## How To Use It

### 1. Configuration
Create a file at `lsp-server/config.json` in your workspace root to register your steppers:

```json
{
  "steppers": [
    "@haibun/web-playwright/build/web-playwright",
    "../modules/my-local-stepper"
  ]
}
```

### 2. Running
Currently, run the extension from the source:

1.  **Build Monorepo**: Run `npm run build:tsc` in the root `haibun` directory.
2.  **Install Deps**: Run `npm install` in the `vscode-extension` directory.
3.  **Launch**: Open the `vscode-extension` folder in VS Code and press **F5**.

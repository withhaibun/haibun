# Haibun VS Code Extension

Provides autocomplete, hover documentation, and navigation for Haibun `.feature` files.

## Architecture

The extension launches a Haibun stepper configured with `./lsp-server/config.json` to load steppers that host the language server. Once loaded, a sidebar panel allows you to configure the extension for a specific working directory, base, and configuration.

## Development

### Prerequisites

1. **Build Monorepo**: Run `npm run build:tsc` in the root `haibun` directory.
2. **Install Dependencies**: Run `npm install` in the `vscode-extension` directory.

### Running in Debug Mode

Open the `vscode-extension` folder in your IDE and press **F5**.

### Packaging and Installation

To test the extension is a local instance of VS Code, VSCodium, Antigravity etc (replace `IDE` with `code`, `codium`, `antigravity` etc):

1. **Package the extension**:
   ```bash
   cd vscode-extension
   npx vsce package
   ```

2. **Uninstall existing version**:
   ```bash
   IDE --uninstall-extension haibun.haibun-lsp
   ```

3. **Install new version**:
   ```bash
   IDE --install-extension haibun-lsp-0.1.xx.vsix
   ```

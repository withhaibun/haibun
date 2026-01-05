# Haibun VS Code Extension

Provides autocomplete, hover documentation, and navigation for Haibun `.feature` files.

## Architecture

The extension launches a Haibun stepper configured with `./lsp-server/config.json` to load steppers that host the language server. Once loaded, a sidebar panel allows you to configure the extension for a specific working directory, base, and configuration.

## Development

### Prerequisites

1. **Build Monorepo**: Run `npm run build:tsc` in the root `haibun` directory.
2. **Install Dependencies**: Run `npm install` in the `vscode-extension` directory.

### Packaging and Installation

To test the extension is a local instance of VS Code, VSCodium, Antigravity etc (replace `IDE` with `code`, `codium`, `antigravity` etc):

1. **Package the extension**:
   ```bash
   cd vscode-extension
   npx vsce package # do not use --no-dependencies
   ```

2. **Uninstall existing version**:
   ```bash
   IDE --uninstall-extension haibun.haibun-lsp
   ```

3. **Install new version**:
   ```bash
   IDE --install-extension haibun-lsp-0.1.xx.vsix
   ```

After re-installation, restart your IDE. A triangle icon on the left provides or a status bar on the lower right provides access to Haibun language server and MCP features.

### Running in Debug Mode

Open the `vscode-extension` folder in your IDE and press **F5**.

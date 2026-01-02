import * as vscode from 'vscode';

export class HaibunConfigurationPanel {
  public static currentPanel: HaibunConfigurationPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _config: { bases: string[]; configFile: string; cwd: string };

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._config = { bases: [], configFile: '', cwd: '' };

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'apply':
            this._applyConfiguration(message.bases, message.configFile, message.cwd);
            return;
        }
      },
      null,
      this._disposables
    );
  }

  public static createOrShow(extensionUri: vscode.Uri, currentConfig: { bases: string[]; configFile: string; cwd: string }) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (HaibunConfigurationPanel.currentPanel) {
      HaibunConfigurationPanel.currentPanel._panel.reveal(column);
      HaibunConfigurationPanel.currentPanel._update(currentConfig);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      'haibunConfiguration',
      'Haibun Configuration',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true // Keep state
      }
    );

    HaibunConfigurationPanel.currentPanel = new HaibunConfigurationPanel(panel, extensionUri);

    // DELAY handling to avoid InvalidStateError in some environments?
    setTimeout(() => {
      if (HaibunConfigurationPanel.currentPanel) {
        HaibunConfigurationPanel.currentPanel._update(currentConfig);
      }
    }, 100);
  }

  public dispose() {
    HaibunConfigurationPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  public _update(config: { bases: string[]; configFile: string; cwd: string }) {
    this._config = config;
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
  }

  private _applyConfiguration(bases: string[], configFile: string, cwd: string) {
    vscode.commands.executeCommand('haibun.applyConfiguration', { bases, configFile, cwd });
    vscode.window.showInformationMessage(`Haibun configuration applied.`);
  }

  public _updateWorkspaceInfo(info: any) {
    this._panel.webview.postMessage({ command: 'workspaceInfo', info });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    // Generate a nonce
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Haibun Configuration</title>
  <style>
    body { padding: 20px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background-color: var(--vscode-editor-background); }
    h2 { margin-top: 0; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 5px; font-weight: bold; }
    input[type="text"] { width: 100%; padding: 8px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    button { padding: 10px 20px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .help { font-size: 0.9em; color: var(--vscode-descriptionForeground); margin-top: 5px; opacity: 0.8; }
    code { font-family: monospace; background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; }
    .info-box { background: var(--vscode-textBlockQuote-background); padding: 10px; border-left: 4px solid var(--vscode-textBlockQuote-border); margin-bottom: 5px; }
    .status-line { margin: 5px 0; font-size: 0.9em; }
  </style>
</head>
<body>
  <h2>Haibun Workspace Configuration</h2>

  <div class="form-group">
    <label for="cwd">Working Directory (CWD)</label>
    <div id="cwd-info" class="info-box" style="display:none"></div>
    <input type="text" id="cwd" value="${this._config.cwd}" placeholder="${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''}">
    <div class="help">
        The process will run from this directory. 
        Use <code>e2e-tests</code> if your config.json is there and uses relative paths like <code>./build-local</code>.
        Leave empty for Workspace Root.
    </div>
  </div>

  <div class="form-group">
    <label for="bases">Base Directories</label>
    <div id="bases-info" class="info-box" style="display:none"></div>
    <input type="text" id="bases" value="${this._config.bases.join(', ')}" placeholder="features, ../shared">
    <div class="help">Comma-separated paths containing <code>features/</code> and <code>backgrounds/</code>. Relative to Workspace Root (usually).</div>
  </div>

  <div class="form-group">
    <label for="configFile">Config File</label>
    <div id="config-info" class="info-box" style="display:none"></div>
    <input type="text" id="configFile" value="${this._config.configFile}" placeholder="config.json">
    <div class="help">Path to <code>config.json</code> defining steppers.</div>
  </div>

  <button id="apply">Apply Configuration</button>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    
    document.getElementById('apply').addEventListener('click', () => {
      const bases = document.getElementById('bases').value.split(',').map(s => s.trim()).filter(s => s.length > 0);
      const configFile = document.getElementById('configFile').value.trim();
      const cwd = document.getElementById('cwd').value.trim();
      
      vscode.postMessage({
        command: 'apply',
        bases: bases,
        configFile: configFile,
        cwd: cwd
      });
    });

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'workspaceInfo') {
            const info = message.info;
            
            const basesInfo = document.getElementById('bases-info');
            if (info.backgroundCount !== undefined) {
                basesInfo.style.display = 'block';
                basesInfo.innerHTML = \`Found <strong>\${info.backgroundCount}</strong> backgrounds in resolved workspace.\`;
            }

            const configInfo = document.getElementById('config-info');
            if (info.stepperCount !== undefined) {
                configInfo.style.display = 'block';
                configInfo.innerHTML = \`Loaded <strong>\${info.stepperCount}</strong> steppers from config.\`;
            }
        }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

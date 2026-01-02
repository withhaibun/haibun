import * as path from 'path';
import { ExtensionContext, workspace } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext): void {
  console.log('[Haibun LSP] Extension activating...');

  // Get workspace root
  const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  console.log('[Haibun LSP] Workspace root:', workspaceRoot);

  // Build absolute path to lsp-server
  const lspServerPath = path.join(workspaceRoot, 'lsp-server');
  console.log('[Haibun LSP] LSP server path:', lspServerPath);

  // Server options - run haibun-cli via npx
  const serverOptions: ServerOptions = {
    run: {
      command: 'npx',
      args: ['@haibun/cli', lspServerPath, '--with-steppers=@haibun/monitor-browser'],
      transport: TransportKind.stdio,
      options: { cwd: workspaceRoot }
    },
    debug: {
      command: 'npx',
      args: ['@haibun/cli', lspServerPath, '--with-steppers=@haibun/monitor-browser'],
      transport: TransportKind.stdio,
      options: { cwd: workspaceRoot, execArgv: ['--nolazy', '--inspect=6009'] }
    },
  };

  // Client options - activate for .feature files
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'haibun' },
    ],
  };

  // Create and start the client
  client = new LanguageClient(
    'haibunLsp',
    'Haibun Language Server',
    serverOptions,
    clientOptions
  );

  console.log('[Haibun LSP] Starting client...');
  client.start().then(() => {
    console.log('[Haibun LSP] Client started successfully');
  }).catch((error) => {
    console.error('[Haibun LSP] Client failed to start:', error);
  });
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

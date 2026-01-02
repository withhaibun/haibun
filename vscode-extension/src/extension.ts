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
  // Path to the LSP server
  const serverModule = path.join(
    context.extensionPath,
    '..',
    'modules',
    'lsp',
    'build',
    'lsp-server.js'
  );

  // Get config path from settings or use default
  const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const configPath = path.join(workspaceRoot, 'lsp-server', 'config.json');

  // Server options - run the LSP server via Node.js with config
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.stdio,
      args: ['--config', configPath],
    },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      args: ['--config', configPath],
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  // Client options - activate for .feature files
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'feature' },
    ],
  };

  // Create and start the client
  client = new LanguageClient(
    'haibunLsp',
    'Haibun Language Server',
    serverOptions,
    clientOptions
  );

  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

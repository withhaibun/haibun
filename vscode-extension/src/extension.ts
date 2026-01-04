import * as path from 'path';
import * as fs from 'fs';
import { ExtensionContext, workspace, window, StatusBarAlignment, StatusBarItem, OutputChannel, commands, ConfigurationChangeEvent } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind, State } from 'vscode-languageclient/node';
import { HaibunConfigurationTreeProvider, HaibunConfig, registerConfigCommands, WorkspaceInfo } from './HaibunConfigurationPanel';

const VERSION = '0.1.57';

let client: LanguageClient | undefined;
let statusBarItem: StatusBarItem;
let outputChannel: OutputChannel;
let retryCount = 0;
const MAX_RETRIES = 2;
let configProvider: HaibunConfigurationTreeProvider;

export function activate(context: ExtensionContext): void {
  outputChannel = window.createOutputChannel('Haibun LSP');
  outputChannel.appendLine(`[Haibun] Extension v${VERSION} activating...`);

  // Register the native TreeDataProvider for sidebar
  configProvider = new HaibunConfigurationTreeProvider();
  configProvider.setExtensionPath(context.extensionPath);

  const treeView = window.createTreeView('haibun.configurationView', {
    treeDataProvider: configProvider,
    showCollapseAll: false
  });
  context.subscriptions.push(treeView);

  // Helper to reveal current file
  const revealCurrentFile = () => {
    const editor = window.activeTextEditor;
    if (!editor) return;

    const filePath = editor.document.uri.fsPath;
    if (!filePath.endsWith('.feature') && !filePath.endsWith('.feature.ts')) return;

    // Find and reveal the file in the tree
    const node = configProvider.findNodeByPath(filePath);
    if (node) {
      outputChannel.appendLine(`[Reveal] Found node for ${path.basename(filePath)}, revealing...`);
      treeView.reveal(node, { select: true, expand: true }).then(
        () => outputChannel.appendLine(`[Reveal] Success for ${path.basename(filePath)}`),
        (e) => outputChannel.appendLine(`[Reveal] Error revealing ${path.basename(filePath)}: ${e}`)
      );
    } else {
      outputChannel.appendLine(`[Reveal] Node not found for ${filePath}. Refreshing and retrying...`);
      configProvider.refresh();
      // Retry once after refresh lookup
      setTimeout(() => {
        const retryNode = configProvider.findNodeByPath(filePath);
        if (retryNode) {
          outputChannel.appendLine(`[Reveal] Retry successful for ${path.basename(filePath)}`);
          treeView.reveal(retryNode, { select: true, expand: true });
        } else {
          outputChannel.appendLine(`[Reveal] Retry failed for ${filePath}`);
        }
      }, 500);
    }
  };

  // Listen for tree updates to re-sync selection (fixes 'visit twice' bug)
  configProvider.onDidChangeTreeData(() => {
    outputChannel.appendLine('[Tree] Data changed, attempting reveal...');
    revealCurrentFile();
  });

  // Auto-reveal feature file in tree when active editor changes
  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(() => {
      // Small delay to allow tree view state to settle
      setTimeout(() => revealCurrentFile(), 100);
    })
  );

  // Initial refresh to populate caches immediately
  configProvider.refresh();

  // Attempt to reveal immediately in case a feature file is already open
  revealCurrentFile();
  // Retry after a short delay to handle startup timing issues
  setTimeout(() => revealCurrentFile(), 2000);

  // Register edit commands for inline editing
  registerConfigCommands(context, configProvider);

  statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(loading~spin) Haibun';
  statusBarItem.command = 'haibun.configure';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register Commands
  context.subscriptions.push(
    commands.registerCommand('haibun.configure', () => {
      // Focus the sidebar view
      commands.executeCommand('haibun.configurationView.focus');
      // Refresh it with current config
      configProvider.refresh();
      // Try revealing after refresh
      revealCurrentFile();
    })
  );

  context.subscriptions.push(
    commands.registerCommand('haibun.applyConfiguration', async (data: HaibunConfig) => {
      const config = workspace.getConfiguration('haibun');
      await config.update('bases', data.bases, false);
      await config.update('configFile', data.configFile, false);
      await config.update('cwd', data.cwd, false);
      window.showInformationMessage('Haibun Configuration Saved');
    })
  );

  // Manual LSP restart command
  context.subscriptions.push(
    commands.registerCommand('haibun.restart', async () => {
      outputChannel.appendLine('[Haibun] Manual restart requested...');
      retryCount = 0;
      await stopClient();
      startClient(context, revealCurrentFile);
      window.showInformationMessage('Haibun LSP restarting...');
    })
  );

  // Start Client
  startClient(context, revealCurrentFile);

  // Config Listener
  context.subscriptions.push(workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
    if (e.affectsConfiguration('haibun')) {
      outputChannel.appendLine('[Haibun] Config changed, restarting...');
      retryCount = 0;
      await stopClient();
      startClient(context, revealCurrentFile);
    }
  }));
}

export function deactivate(): Thenable<void> | undefined {
  return stopClient();
}

async function stopClient() {
  if (!client) return;
  try {
    const c = client;
    client = undefined;
    await c.stop();
  } catch (e) {
    // Ignore errors during stop
  }
}

/**
 * Parses server errors into user-friendly messages with actionable suggestions
 */
function parseServerError(error: unknown): { type: string; message: string; action: string } {
  const errorStr = String(error);

  if (errorStr.includes('EADDRINUSE')) {
    const portMatch = errorStr.match(/::(\d+)/) || errorStr.match(/:(\d+)/);
    const port = portMatch ? portMatch[1] : 'unknown';
    return {
      type: 'port-conflict',
      message: `Port ${port} is already in use`,
      action: `Kill the process using port ${port} or remove monitor-browser from your config`
    };
  }

  if (errorStr.includes('ERR_MODULE_NOT_FOUND') || errorStr.includes('Cannot find')) {
    const moduleMatch = errorStr.match(/Cannot find (?:package|module) '([^']+)'/) ||
      errorStr.match(/ERR_MODULE_NOT_FOUND.*'([^']+)'/);
    return {
      type: 'missing-module',
      message: `Missing module: ${moduleMatch?.[1] || 'unknown'}`,
      action: 'Run npm install in your workspace or check stepper paths in config.json'
    };
  }

  if (errorStr.includes('connection got disposed') || errorStr.includes('Server crashed')) {
    return {
      type: 'server-crash',
      message: 'LSP server crashed during startup',
      action: 'Check the Haibun LSP output for details'
    };
  }

  return {
    type: 'unknown',
    message: errorStr.substring(0, 200),
    action: 'Check the Haibun LSP output channel for details'
  };
}

async function startClient(context: ExtensionContext, onVerifyReveal: () => void) {
  const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  // Safe base bundled with extension
  const safeBase = path.join(context.extensionPath, 'lsp-server');

  outputChannel.appendLine(`[Haibun] Workspace: ${workspaceRoot}`);
  outputChannel.appendLine(`[Haibun] Safe Base: ${safeBase}`);

  // 1. RESOLVE CLI PATH
  let cliPath = resolveCliPath(workspaceRoot);
  if (!cliPath) {
    // Fallback to bundled CLI or error
    // For now error, but ideally we bundle CLI too or finding it is critical
    outputChannel.appendLine('[Haibun] FATAL: Could not find haibun cli.js');
    statusBarItem.text = '$(error) Haibun: No CLI';
    return;
  }
  outputChannel.appendLine(`[Haibun] Using CLI: ${cliPath}`);

  // 2. DIAGNOSE CONFIG (User info only, not used for execution)
  const config = workspace.getConfiguration('haibun');
  const userBases = config.get<string[]>('bases') || [];
  const userConfigFile = config.get<string>('configFile') || '';
  const userCwd = config.get<string>('cwd') || '';

  // Calculate effective CWD for context
  const effectiveCwd = userCwd
    ? (path.isAbsolute(userCwd) ? userCwd : path.resolve(workspaceRoot, userCwd))
    : workspaceRoot;

  outputChannel.appendLine(`[Haibun] User CWD: ${effectiveCwd}`);
  outputChannel.appendLine(`[Haibun] User Config: ${userConfigFile}`);
  outputChannel.appendLine(`[Haibun] User Bases: ${JSON.stringify(userBases)}`);

  // 3. PREPARE SERVER
  // We use the safe base's feature (which includes @haibun/lsp)
  // LSP discovers user's features/backgrounds from opened documents, not from CLI args
  const args = [cliPath, safeBase, 'serve-lsp'];

  // Read user's config.json to extract their steppers, then pass via --with-steppers
  // This avoids duplication since CLI merges them
  if (userConfigFile) {
    const configPath = path.isAbsolute(userConfigFile)
      ? userConfigFile
      : path.resolve(effectiveCwd, userConfigFile);

    if (fs.existsSync(configPath)) {
      try {
        // Read bundled config to get steppers we already have (DRY - don't hardcode)
        const bundledConfigPath = path.join(safeBase, 'config.json');
        let bundledSteppers: Set<string> = new Set();
        if (fs.existsSync(bundledConfigPath)) {
          try {
            const bundledConfig = JSON.parse(fs.readFileSync(bundledConfigPath, 'utf-8'));
            if (bundledConfig.steppers && Array.isArray(bundledConfig.steppers)) {
              bundledSteppers = new Set(bundledConfig.steppers);
            }
          } catch (e) {
            outputChannel.appendLine(`[Haibun] Warning: Could not read bundled config: ${e}`);
          }
        } else {
          outputChannel.appendLine(`[Haibun] Error: Bundled config not found at ${bundledConfigPath}`);
        }

        const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (userConfig.steppers && Array.isArray(userConfig.steppers)) {
          // Resolve relative paths and filter out duplicates
          const resolvedSteppers = userConfig.steppers
            .filter((s: string) => !bundledSteppers.has(s))
            .map((s: string) => {
              if (s.startsWith('./') || s.startsWith('../')) {
                return path.resolve(effectiveCwd, s);
              }
              return s;
            });

          if (resolvedSteppers.length > 0) {
            const steppersArg = resolvedSteppers.join(',');
            args.push('--with-steppers', steppersArg);
            outputChannel.appendLine(`[Haibun] Adding ${resolvedSteppers.length} steppers (filtered from ${userConfig.steppers.length})`);
          }
        }
      } catch (e) {
        outputChannel.appendLine(`[Haibun] Warning: Could not parse user config: ${e}`);
      }
    } else {
      outputChannel.appendLine(`[Haibun] Warning: User config not found at ${configPath}`);
    }
  }

  outputChannel.appendLine(`[Haibun] Starting: node ${args.join(' ')}`);

  // No special env vars needed - we only load LspStepper
  const env = { ...process.env };

  const serverOptions: ServerOptions = {
    run: { command: 'node', args, transport: TransportKind.stdio, options: { cwd: workspaceRoot, env } },
    debug: { command: 'node', args, transport: TransportKind.stdio, options: { cwd: workspaceRoot, env, execArgv: ['--nolazy', '--inspect=6009'] } }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'haibun' },
      { scheme: 'file', pattern: '**/*.feature.ts' }
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/config.json')
    }
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    'haibun',
    'Haibun Language Server',
    serverOptions,
    clientOptions
  );

  // 5. START AND HANDLE EVENTS
  try {
    // Start the client. This will also launch the server
    await client.start();

    outputChannel.appendLine('[Haibun] Client started successfully.');
    retryCount = 0;  // Reset retry count on successful start
    configProvider.clearError();  // Clear any previous errors from sidebar
    statusBarItem.text = '$(check) Haibun: Ready';
    statusBarItem.tooltip = `Base: ${userBases[0]}`;

    // Handle haibun/workspaceInfo notification for the status panel
    client.onNotification('haibun/workspaceInfo', (info: WorkspaceInfo) => {
      const baseName = info.base === 'Default' ? 'Default' : path.basename(info.base || 'Default');
      statusBarItem.text = `$(file-code) ${baseName}`;
      statusBarItem.tooltip = `Base: ${info.base || 'Default'}\nSteppers: ${info.stepperCount || 0}`;

      // Update the sidebar view with workspace info
      configProvider.updateWorkspaceInfo(info);

      // Try revealing again, now that we have fresh workspace info
      onVerifyReveal();
    });

    // Handle unexpected stops with retry logic
    client.onDidChangeState(async (e) => {
      if (e.newState === State.Stopped) {
        retryCount++;
        if (retryCount <= MAX_RETRIES) {
          outputChannel.appendLine(`[Haibun] Server stopped unexpectedly. Retry ${retryCount}/${MAX_RETRIES}...`);
          statusBarItem.text = `$(loading~spin) Haibun: Retry ${retryCount}`;
          await stopClient();
          startClient(context, onVerifyReveal);
        } else {
          outputChannel.appendLine('[Haibun] Max retries reached. LSP disabled.');
          statusBarItem.text = '$(error) Haibun: Stopped';
          statusBarItem.tooltip = 'LSP stopped after multiple failures. Click to restart.';
          configProvider.setError('Server crashed after multiple retries', 'Click the error above to restart, or check config.json for bad steppers');
          window.showWarningMessage(
            'Haibun LSP stopped after multiple failures. Check the output for details.',
            'Show Output',
            'Restart'
          ).then(selection => {
            if (selection === 'Show Output') outputChannel.show();
            if (selection === 'Restart') {
              retryCount = 0;
              startClient(context, onVerifyReveal);
            }
          });
        }
      }
    });

  } catch (error) {
    const parsed = parseServerError(error);
    outputChannel.appendLine(`[Haibun] STARTUP ERROR (${parsed.type}): ${parsed.message}`);
    outputChannel.appendLine(`[Haibun] Suggested action: ${parsed.action}`);
    statusBarItem.text = '$(error) Haibun: Failed';
    statusBarItem.tooltip = `${parsed.message}\n\nClick to see details`;
    configProvider.setError(parsed.message, parsed.action);

    // Show actionable notification to user
    window.showErrorMessage(
      `Haibun LSP: ${parsed.message}`,
      'Show Output',
      'Retry'
    ).then(selection => {
      if (selection === 'Show Output') {
        outputChannel.show();
      } else if (selection === 'Retry') {
        retryCount = 0;
        startClient(context, onVerifyReveal);
      }
    });
  }
}

/**
 * Tries to find the CLI entry point in standard locations
 */
function resolveCliPath(root: string): string | null {
  // === 0. Manual Override (The "Escape Hatch") ===
  const config = workspace.getConfiguration('haibun');
  const manualPath = config.get<string>('cliPath');
  if (manualPath) {
    const resolved = path.isAbsolute(manualPath)
      ? manualPath
      : path.resolve(root, manualPath);

    if (fs.existsSync(resolved)) {
      return resolved;
    }
    outputChannel.appendLine(`[Haibun] Warning: configured cliPath not found: ${resolved}`);
  }

  const candidates = [
    // === 1. Consumer Mode (Standard) ===
    path.join(root, 'node_modules', '@haibun', 'cli', 'build', 'cli.js'),
    path.join(root, 'node_modules', 'haibun', 'modules', 'cli', 'build', 'cli.js'),

    // === 2. Contributor Mode (Dev) ===
    path.join(root, 'modules', 'cli', 'build', 'cli.js'),
  ];

  for (const candidate of candidates) {
    outputChannel.appendLine(`[Haibun] Checking CLI candidate: ${candidate}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

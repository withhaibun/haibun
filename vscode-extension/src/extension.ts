import * as path from 'path';
import * as fs from 'fs';
import { ExtensionContext, workspace, window, commands, StatusBarItem, StatusBarAlignment, OutputChannel, ConfigurationChangeEvent } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind, State } from 'vscode-languageclient/node';
import { HaibunConfigurationTreeProvider, HaibunConfig, registerConfigCommands, WorkspaceInfo } from './HaibunConfigurationPanel';

const VERSION = '0.1.78';

let client: LanguageClient | undefined;
let statusBarItem: StatusBarItem;
let outputChannel: OutputChannel;
let configProvider: HaibunConfigurationTreeProvider;
let retryCount = 0;
const MAX_RETRIES = 2;

// CLI resolution helper
function resolveCliPath(workspaceRoot: string): string | undefined {
  // 1. Try node_modules/.bin/haibun-cli (standard installation)
  const binPath = path.join(workspaceRoot, 'node_modules', '.bin', 'haibun-cli');
  if (fs.existsSync(binPath)) return binPath;

  // 2. Try node_modules/@haibun/cli/build/cli.js (monorepo/direct)
  const directPath = path.join(workspaceRoot, 'node_modules', '@haibun', 'cli', 'build', 'cli.js');
  if (fs.existsSync(directPath)) return directPath;

  return undefined;
}

export function activate(context: ExtensionContext) {
  outputChannel = window.createOutputChannel('Haibun LSP');
  outputChannel.appendLine(`[Haibun] Extension v${VERSION} activating...`);

  // Register Configuration Provider
  configProvider = new HaibunConfigurationTreeProvider();
  configProvider.setExtensionPath(context.extensionPath, VERSION);

  // Create TreeView and link it for reveal functionality
  const treeView = window.createTreeView('haibun.configurationView', { treeDataProvider: configProvider });
  configProvider.setTreeView(treeView);

  statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(loading~spin) Haibun';
  statusBarItem.command = 'haibun.configure';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register Commands
  context.subscriptions.push(
    commands.registerCommand('haibun.configure', () => {
      commands.executeCommand('haibun.configurationView.focus');
      configProvider.refresh();
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
      startClient(context);
      window.showInformationMessage('Haibun Restarting...');
    })
  );

  // Start Client
  startClient(context);

  // Config Listener
  context.subscriptions.push(workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
    if (e.affectsConfiguration('haibun')) {
      outputChannel.appendLine('[Haibun] Config changed, restarting...');
      retryCount = 0;
      await stopClient();
      startClient(context);
    }
  }));

  // Auto-reveal feature file in tree when active editor changes
  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(() => {
      setTimeout(() => revealCurrentFile(), 100);
    })
  );

  // Initial reveal attempt
  setTimeout(() => revealCurrentFile(), 2000);

  registerConfigCommands(context, configProvider);
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
    configProvider.setLspStatus('stopped');
    configProvider.setMcpStatus('stopped');
  } catch (e) {
    // Ignore error
  }
}

function parseServerError(error: unknown): { type: string; message: string; action: string } {
  const errorStr = String(error);

  if (errorStr.includes('McpStepper: ACCESS_TOKEN is required')) {
    return {
      type: 'config-error',
      message: 'MCP Access Token is required',
      action: 'Set Haibun: Mcp Access Token in Config'
    };
  }

  if (errorStr.includes('McpStepper: No webserver found')) {
    return {
      type: 'config-error',
      message: 'MCP requires WebServerStepper',
      action: 'Add @haibun/web-server-hono/build/web-server-stepper to config'
    };
  }

  if (errorStr.includes('EADDRINUSE')) {
    const portMatch = errorStr.match(/::(\d+)/) || errorStr.match(/:(\d+)/);
    const port = portMatch ? portMatch[1] : 'unknown';
    return {
      type: 'port-conflict',
      message: `Port ${port} is already in use`,
      action: `Kill process on port ${port} or change config`
    };
  }

  if (errorStr.includes('ERR_MODULE_NOT_FOUND') || errorStr.includes('Cannot find')) {
    const moduleMatch = errorStr.match(/Cannot find module '([^']+)'/);
    const module = moduleMatch ? path.basename(moduleMatch[1]) : 'module';
    return {
      type: 'missing-module',
      message: `Missing ${module}`,
      action: 'Run npm install or check paths'
    };
  }

  return {
    type: 'unknown',
    message: 'Check Output channel for details',
    action: 'View Output'
  };
}

// File reveal logic with retries
function revealCurrentFile() {
  // Try to reveal even if client is undefined (using cached tree data)
  const editor = window.activeTextEditor;
  if (editor && (editor.document.languageId === 'haibun' || editor.document.fileName.endsWith('.feature.ts')) && configProvider) {
    const filePath = editor.document.uri.fsPath;
    setTimeout(() => {
      if (configProvider.revealFile && configProvider.revealFile(filePath)) {
        // Success
      } else {
        // outputChannel?.appendLine(`[Reveal] Pending tree population for ${path.basename(filePath)}`);
      }
    }, 500);
  }
}

async function startClient(context: ExtensionContext) {
  configProvider.setLspStatus('starting');
  const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const safeBase = path.join(context.extensionPath, 'lsp-server');

  outputChannel.appendLine(`[Haibun] Workspace: ${workspaceRoot}`);
  outputChannel.appendLine(`[Haibun] Safe Base: ${safeBase}`);

  let cliPath = resolveCliPath(workspaceRoot);
  if (!cliPath) {
    outputChannel.appendLine('[Haibun] FATAL: Could not find haibun cli.js');
    statusBarItem.text = '$(error) Haibun: No CLI';
    configProvider.setLspStatus('error', 'No CLI found');
    configProvider.setError('Haibun CLI not found', 'Run npm install in your workspace');
    return;
  }
  outputChannel.appendLine(`[Haibun] Using CLI: ${cliPath}`);

  const config = workspace.getConfiguration('haibun');
  const userBases = config.get<string[]>('bases') || [];
  const userConfigFile = config.get<string>('configFile') || '';
  const userCwd = config.get<string>('cwd') || '';
  const effectiveCwd = userCwd
    ? (path.isAbsolute(userCwd) ? userCwd : path.resolve(workspaceRoot, userCwd))
    : workspaceRoot;

  outputChannel.appendLine(`[Haibun] User CWD: ${effectiveCwd}`);

  // PREPARE ENVIRONMENT
  const env = { ...process.env };
  const mcpEnabled = config.get<boolean>('mcpEnabled') ?? false;

  if (mcpEnabled) {
    const mcpPort = config.get<number>('mcpPort') ?? 8765;
    const mcpToken = config.get<string>('mcpAccessToken') || '';

    if (mcpToken) {
      env['HAIBUN_O_WEBSERVERSTEPPER_PORT'] = String(mcpPort);
      env['HAIBUN_O_MCPSTEPPER_ACCESS_TOKEN'] = mcpToken;
      configProvider.setMcpStatus('starting');
    } else {
      configProvider.setMcpStatus('error', 'No Access Token');
    }
  } else {
    configProvider.setMcpStatus('disabled');
  }

  // PREPARE STEPPERS
  const steppersToAdd: Set<string> = new Set();

  steppersToAdd.add('@haibun/lsp/build/monitor-json-rpc');

  if (mcpEnabled) {
    steppersToAdd.add('@haibun/web-server-hono/build/web-server-stepper');
    steppersToAdd.add('@haibun/web-server-hono/build/mcp-stepper');
  }

  let userConfigSteppers: string[] = [];
  if (userConfigFile) {
    const configPath = path.isAbsolute(userConfigFile) ? userConfigFile : path.resolve(effectiveCwd, userConfigFile);
    if (fs.existsSync(configPath)) {
      try {
        const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (userConfig.steppers && Array.isArray(userConfig.steppers)) {
          userConfigSteppers = userConfig.steppers;
          userConfig.steppers.forEach((s: string) => steppersToAdd.add(s));
        }
      } catch (e) {
        outputChannel.appendLine(`[Haibun] Warning: Failed to read user config: ${e}`);
      }
    }
  }

  // Filter out steppers already in bundled config
  const bundledConfigPath = path.join(safeBase, 'config.json');
  let bundledSteppers: Set<string> = new Set();
  if (fs.existsSync(bundledConfigPath)) {
    try {
      const bundledConfig = JSON.parse(fs.readFileSync(bundledConfigPath, 'utf-8'));
      if (bundledConfig.steppers) bundledSteppers = new Set(bundledConfig.steppers);
    } catch (e) { /* ignore */ }
  }

  for (const s of bundledSteppers) {
    steppersToAdd.delete(s);
  }

  const args = [cliPath, safeBase, 'serve-lsp'];
  if (steppersToAdd.size > 0) {
    args.push('--with-steppers', Array.from(steppersToAdd).join(','));
    outputChannel.appendLine(`[Haibun] Adding steppers: ${Array.from(steppersToAdd).join(', ')}`);
  }

  // Calculate explicit lists for UI
  const bundledList = Array.from(new Set([...bundledSteppers, ...steppersToAdd])).sort();
  const configuredList = userConfigSteppers.sort();

  configProvider.setSteppers(bundledList, configuredList);

  outputChannel.appendLine(`[Haibun] Starting: node ${args.join(' ')}`);

  const serverOptions: ServerOptions = {
    run: { command: 'node', args, transport: TransportKind.stdio, options: { cwd: effectiveCwd, env } },
    debug: { command: 'node', args, transport: TransportKind.stdio, options: { cwd: effectiveCwd, env, execArgv: ['--nolazy', '--inspect=6009'] } }
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

  client = new LanguageClient(
    'haibun',
    'Haibun Language Server',
    serverOptions,
    clientOptions
  );

  try {
    await client.start();

    outputChannel.appendLine('[Haibun] Client started successfully.');
    configProvider.setLspStatus('running', `v${VERSION}`);
    if (mcpEnabled) configProvider.setMcpStatus('running');

    retryCount = 0;
    configProvider.clearError();
    statusBarItem.text = '$(check) Haibun: Ready';
    statusBarItem.tooltip = `Base: ${userBases[0]}`;

    client.onNotification('haibun/workspaceInfo', (info: WorkspaceInfo) => {
      const baseName = info.base === 'Default' ? 'Default' : path.basename(info.base || 'Default');
      statusBarItem.text = `$(file-code) ${baseName}`;
      statusBarItem.tooltip = `Base: ${info.base || 'Default'}\nSteppers: ${info.stepperCount || 0}`;
      configProvider.updateWorkspaceInfo(info);
      revealCurrentFile();
    });

    client.onDidChangeState(async (e) => {
      if (e.newState === State.Stopped) {
        configProvider.setLspStatus('stopped');
        configProvider.setMcpStatus('stopped');
        retryCount++;
        if (retryCount <= MAX_RETRIES) {
          const timeout = retryCount * 1000;
          outputChannel.appendLine(`[Haibun] Server stopped. Retry ${retryCount}/${MAX_RETRIES} in ${timeout}ms...`);
          configProvider.setLspStatus('starting', `Restarting (${retryCount})...`);
          setTimeout(async () => {
            try { await client?.start(); } catch (err) { /* ignore */ }
          }, timeout);
        } else {
          outputChannel.appendLine('[Haibun] Max retries reached.');
          configProvider.setLspStatus('error', 'Max retries reached');
          if (mcpEnabled) configProvider.setMcpStatus('error', 'Parent process stopped');
          configProvider.setError('Sever failed', 'Check Output channel');
        }
      }
    });

  } catch (error) {
    outputChannel.appendLine(`[Haibun] Client start failed: ${error}`);
    const problem = parseServerError(error);
    configProvider.setLspStatus('error', problem.type);
    if (mcpEnabled) configProvider.setMcpStatus('error', 'Parent process stopped');
    configProvider.setError(problem.message, problem.action);
  }
}

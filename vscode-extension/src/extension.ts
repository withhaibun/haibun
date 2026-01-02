import * as path from 'path';
import * as fs from 'fs';
import { ExtensionContext, workspace, window, StatusBarAlignment, StatusBarItem, OutputChannel, commands, ConfigurationChangeEvent } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind, State } from 'vscode-languageclient/node';
import { HaibunConfigurationPanel } from './HaibunConfigurationPanel';

const VERSION = '2026-01-02T18:50';

let client: LanguageClient | undefined;
let statusBarItem: StatusBarItem;
let outputChannel: OutputChannel;
let useFallback = false;

export function activate(context: ExtensionContext): void {
  outputChannel = window.createOutputChannel('Haibun LSP');
  outputChannel.appendLine(`[Haibun] Extension v${VERSION} activating...`);

  statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(loading~spin) Haibun';
  statusBarItem.command = 'haibun.configure';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register Commands
  context.subscriptions.push(
    commands.registerCommand('haibun.configure', () => {
      const config = workspace.getConfiguration('haibun');
      HaibunConfigurationPanel.createOrShow(context.extensionUri, {
        bases: config.get<string[]>('bases') || [],
        configFile: config.get<string>('configFile') || '',
        cwd: config.get<string>('cwd') || ''
      });
    })
  );

  context.subscriptions.push(
    commands.registerCommand('haibun.applyConfiguration', async (data: { bases: string[]; configFile: string; cwd: string }) => {
      const config = workspace.getConfiguration('haibun');
      await config.update('bases', data.bases, false);
      await config.update('configFile', data.configFile, false);
      await config.update('cwd', data.cwd, false);
    })
  );

  // Start Client
  startClient(context);

  // Config Listener
  context.subscriptions.push(workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
    if (e.affectsConfiguration('haibun')) {
      outputChannel.appendLine('[Haibun] Config changed, restarting...');
      useFallback = false;
      await stopClient();
      startClient(context);
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

async function startClient(context: ExtensionContext) {
  let workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // Fix for remote workspaces (SSH/WSL)
  if (workspaceRoot.startsWith('/ssh-remote+')) {
    const match = workspaceRoot.match(/\/ssh-remote\+[^\/]+(\/.*)/);
    if (match) workspaceRoot = match[1];
  }

  outputChannel.appendLine(`[Haibun] Workspace: ${workspaceRoot}`);
  outputChannel.appendLine(`[Haibun] Fallback mode: ${useFallback}`);

  // 1. RESOLVE CLI PATH
  const cliPath = resolveCliPath(workspaceRoot);

  if (!cliPath) {
    outputChannel.appendLine('[Haibun] FATAL: Could not find haibun cli.js in node_modules or workspace.');
    statusBarItem.text = '$(error) Haibun: No CLI';
    statusBarItem.tooltip = 'Could not find modules/cli/build/cli.js';
    return;
  }

  outputChannel.appendLine(`[Haibun] Using CLI: ${cliPath}`);

  const config = workspace.getConfiguration('haibun');
  const userBases = config.get<string[]>('bases') || [];
  const userConfigFile = config.get<string>('configFile') || '';
  const fallbackBase = path.join(workspaceRoot, 'lsp-server');

  let bases: string[];
  let cwd: string;
  let configArg: string | null = null;

  // 2. DETERMINE CONFIG
  if (useFallback) {
    outputChannel.appendLine('[Haibun] === FALLBACK MODE ===');
    bases = [fallbackBase];
    cwd = workspaceRoot;
    statusBarItem.text = '$(warning) Haibun: Fallback';
  } else {
    outputChannel.appendLine('[Haibun] === PREFLIGHT CHECK ===');
    outputChannel.appendLine(`[Haibun] User bases: ${JSON.stringify(userBases)}`);
    outputChannel.appendLine(`[Haibun] User configFile: ${userConfigFile || '(none)'}`);

    bases = userBases.length > 0
      ? userBases.map(b => path.resolve(workspaceRoot, b))
      : [fallbackBase];

    cwd = (bases.length > 0 && bases[0] !== fallbackBase)
      ? path.dirname(bases[0])
      : workspaceRoot;

    if (userConfigFile) configArg = path.resolve(workspaceRoot, userConfigFile);

    outputChannel.appendLine(`[Haibun] Resolved bases: ${JSON.stringify(bases)}`);
    outputChannel.appendLine(`[Haibun] Resolved CWD: ${cwd}`);

    // Preflight - check against workspace root (where Haibun resolves paths)
    const preflightError = runPreflight(bases, workspaceRoot, configArg);
    if (preflightError) {
      outputChannel.appendLine(`[Haibun] PREFLIGHT FAILED: ${preflightError}`);
      outputChannel.appendLine('[Haibun] Switching to fallback...');
      useFallback = true;
      // RECURSION SAFEGUARD: Return immediately and call startClient again
      return startClient(context);
    }
    outputChannel.appendLine('[Haibun] Preflight PASSED');
  }

  // 3. FINAL VALIDATION
  if (!fs.existsSync(bases[0])) {
    outputChannel.appendLine(`[Haibun] Base directory missing: ${bases[0]}`);
    statusBarItem.text = '$(error) Haibun: No Base';
    return;
  }

  // 4. PREPARE SERVER
  const args = [cliPath, ...bases];
  if (configArg) args.push('--config', configArg);

  outputChannel.appendLine(`[Haibun] Starting: node ${args.join(' ')}`);
  outputChannel.appendLine(`[Haibun] CWD: ${cwd}`);

  const serverOptions: ServerOptions = {
    run: { command: 'node', args, transport: TransportKind.stdio, options: { cwd } },
    debug: { command: 'node', args, transport: TransportKind.stdio, options: { cwd, execArgv: ['--nolazy', '--inspect=6009'] } }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'haibun' }],
    connectionOptions: { maxRestartCount: 0 }
  };

  client = new LanguageClient('haibunLsp', 'Haibun Language Server', serverOptions, clientOptions);

  // 5. START AND HANDLE EVENTS
  try {
    await client.start();

    outputChannel.appendLine('[Haibun] Client started successfully.');
    if (!useFallback) {
      statusBarItem.text = '$(check) Haibun: Ready';
      statusBarItem.tooltip = `Base: ${bases[0]}`;
    }

    client.onNotification('haibun/workspaceInfo', (info: any) => {
      const baseName = path.basename(info.base);
      statusBarItem.text = useFallback ? `$(warning) ${baseName}` : `$(file-code) ${baseName}`;
      statusBarItem.tooltip = `Base: ${info.base}\nSteppers: ${info.stepperCount}`;

      if (HaibunConfigurationPanel.currentPanel) {
        HaibunConfigurationPanel.currentPanel._updateWorkspaceInfo(info);
      }
    });

    // Handle unexpected stops
    client.onDidChangeState(async (e) => {
      if (e.newState === State.Stopped && !useFallback) {
        outputChannel.appendLine('[Haibun] Server crashed. Retrying with fallback...');
        useFallback = true;
        await stopClient();
        startClient(context);
      }
    });

  } catch (error) {
    outputChannel.appendLine(`[Haibun] STARTUP ERROR: ${error}`);
    if (!useFallback) {
      useFallback = true;
      await stopClient();
      startClient(context);
    } else {
      statusBarItem.text = '$(error) Haibun: Failed';
    }
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

function runPreflight(bases: string[], cwd: string, configFile: string | null): string | null {
  if (configFile && fs.existsSync(configFile)) {
    const err = checkConfig(configFile, cwd);
    if (err) return err;
  }
  for (const base of bases) {
    const baseConfig = path.join(base, 'config.json');
    if (fs.existsSync(baseConfig)) {
      const err = checkConfig(baseConfig, cwd);
      if (err) return err;
    }
  }
  return null;
}

function checkConfig(configPath: string, cwd: string): string | null {
  outputChannel.appendLine(`[Preflight] Checking config: ${configPath}`);
  outputChannel.appendLine(`[Preflight] CWD for stepper resolution: ${cwd}`);

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    if (!Array.isArray(config.steppers)) return null;

    for (const stepper of config.steppers) {
      if (typeof stepper === 'string' && stepper.startsWith('./')) {
        const fullPath = path.resolve(cwd, stepper);
        outputChannel.appendLine(`[Preflight] Checking: ${stepper} -> ${fullPath}`);

        const exists = fs.existsSync(fullPath) ||
          fs.existsSync(fullPath + '.js') ||
          fs.existsSync(path.join(fullPath, 'index.js'));

        if (!exists) {
          outputChannel.appendLine(`[Preflight] NOT FOUND: ${stepper}`);
          return `Stepper not found: ${stepper}`;
        }
        outputChannel.appendLine(`[Preflight] OK: ${stepper}`);
      }
    }
    return null;
  } catch (e) {
    return `Config error: ${e}`;
  }
}

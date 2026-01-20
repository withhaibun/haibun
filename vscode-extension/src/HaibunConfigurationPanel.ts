import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Shared config interface
export interface HaibunConfig {
  bases: string[];
  configFile: string;
  cwd: string;
}

interface DirNode {
  name: string;
  path: string;
  isDir: boolean;
  isBackground: boolean;
  baseName?: string;  // Which base this belongs to
  children: DirNode[];
}

interface BaseEntry {
  name: string;
  features: DirNode | null;
  backgrounds: DirNode | null;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, {
      type: string;
      description?: string;
    }>;
    required?: string[];
  };
}

export interface WorkspaceInfo {
  backgroundCount?: number;
  featureCount?: number;
  stepperCount?: number;
  base?: string;
  mcpTools?: McpTool[];
}

export class HaibunConfigurationTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

  private _workspaceInfo: WorkspaceInfo = {};
  private _bases: BaseEntry[] = [];
  private _configuredSteppers: string[] = [];
  private _bundledSteppers: string[] = [];
  private _mcpTools: McpTool[] = [];
  private _featureCount = 0;
  private _treeView?: vscode.TreeView<TreeNode>;
  private _mcpParamValues: Map<string, string> = new Map();
  private _toolOutputs: Map<string, { content: string; timestamp: Date; isError: boolean; isRunning?: boolean }> = new Map();

  setTreeView(view: vscode.TreeView<TreeNode>): void {
    this._treeView = view;
  }

  setSteppers(bundled: string[], configured: string[]): void {
    this._bundledSteppers = bundled;
    this._configuredSteppers = configured;
    this.refresh();
  }
  private _backgroundCount = 0;
  private _extensionPath: string = '';
  private _version: string = '';
  private _errorMessage: string = '';
  private _errorAction: string = '';

  // Server status tracking
  private _lspStatus: 'starting' | 'running' | 'stopped' | 'error' = 'starting';
  private _lspStatusMessage: string = 'Starting...';
  private _mcpStatus: 'disabled' | 'starting' | 'running' | 'stopped' | 'error' = 'disabled';
  private _mcpStatusMessage: string = '';
  private _checkInterval: NodeJS.Timeout | undefined;

  constructor() {
    this._checkInterval = setInterval(() => this.checkMcpHealth(), 5000);
  }

  dispose() {
    if (this._checkInterval) clearInterval(this._checkInterval);
  }

  setMcpParamValue(toolName: string, paramName: string, value: string) {
    this._mcpParamValues.set(`${toolName}:${paramName}`, value);
    this.refresh();
  }

  getMcpParamValue(toolName: string, paramName: string): string | undefined {
    return this._mcpParamValues.get(`${toolName}:${paramName}`);
  }

  setToolOutput(toolName: string, content: string, isError: boolean): void {
    this._toolOutputs.set(toolName, { content, timestamp: new Date(), isError, isRunning: false });
    this.refresh();
  }

  setToolRunning(toolName: string): void {
    this._toolOutputs.set(toolName, { content: 'Running...', timestamp: new Date(), isError: false, isRunning: true });
    this.refresh();
  }

  clearToolOutput(toolName: string): void {
    this._toolOutputs.delete(toolName);
    this.refresh();
  }

  getToolOutput(toolName: string): { content: string; timestamp: Date; isError: boolean; isRunning?: boolean } | undefined {
    return this._toolOutputs.get(toolName);
  }

  async checkMcpHealth() {
    if (this._mcpStatus === 'disabled') return;
    const config = this._readConfig();
    if (!config?.mcpEnabled) return;
    const port = config.mcpPort || 8128; // Default if missing
    const token = config.mcpToken;

    if (!token) {
      this.setMcpStatus('error', 'Missing Token');
      return;
    }

    try {
      const url = `http://localhost:${port}/mcp`;
      // Manual JSON-RPC 2.0 Initialize
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "vscode-check", version: "1.0" }
          }
        })
      });

      if (!response.ok) {
        // Only update if we were expecting running, or to show error
        if (this._mcpStatus !== 'starting')
          this.setMcpStatus('error', `HTTP ${response.status}`);
        return;
      }

      const json = await response.json() as { result?: { serverInfo?: { version?: string } } };
      const version = json.result?.serverInfo?.version;
      if (version) {
        this.setMcpStatus('running', `v${version} on port ${port}`);
      } else {
        this.setMcpStatus('running', `active on ${port}`);
      }
    } catch (_e) {
      // connection refused etc
      // If we are already 'error' or 'starting', leave it?
      // Let's set to starting or stopped?
      if (this._mcpStatus === 'running') this.setMcpStatus('error', 'Connection lost');
    }
  }

  private _readConfig(): { mcpEnabled: boolean; mcpPort: number; mcpToken: string } | undefined {
    const config = vscode.workspace.getConfiguration('haibun');
    return {
      mcpEnabled: config.get<boolean>('mcpEnabled') ?? false,
      mcpPort: config.get<number>('mcpPort') ?? 8765,
      mcpToken: config.get<string>('mcpAccessToken') || ''
    };
  }

  // For reveal support - cache nodes by file path
  private _nodesByPath: Map<string, TreeNode> = new Map();
  private _parentMap: Map<TreeNode, TreeNode | undefined> = new Map();
  // Cache TreeNodes by DirNode path to ensure stable instances
  private _treeNodeCache: Map<string, TreeNode> = new Map();
  // Cache section nodes (features, backgrounds) by base + type
  private _sectionNodeCache: Map<string, TreeNode> = new Map();
  // Cache base nodes by name
  private _baseNodeCache: Map<string, TreeNode> = new Map();
  // Cache for tool nodes 
  private _toolNodeCache: Map<string, TreeNode> = new Map();

  setExtensionPath(extensionPath: string, version: string): void {
    this._extensionPath = extensionPath;
    this._version = version;
    this._loadBundledSteppers();
  }

  private _loadBundledSteppers(): void {
    if (!this._extensionPath) return;
    const bundledConfigPath = path.join(this._extensionPath, 'lsp-server', 'config.json');
    if (fs.existsSync(bundledConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(bundledConfigPath, 'utf-8'));
        this._bundledSteppers = config.steppers || [];
      } catch { /* ignore */ }
    }
  }

  refresh(): void {
    this._discoverFiles();
    this._rebuildNodeCaches();
    this._onDidChangeTreeData.fire();
  }

  updateWorkspaceInfo(info: WorkspaceInfo): void {
    this._workspaceInfo = info;
    this._mcpTools = info.mcpTools || [];
    this._errorMessage = '';  // Clear error on successful connection
    this._errorAction = '';
    this._discoverFiles();
    this._rebuildNodeCaches();
    this._onDidChangeTreeData.fire();
  }

  setError(message: string, action: string): void {
    this._errorMessage = message;
    this._errorAction = action;
    this._onDidChangeTreeData.fire();
  }

  clearError(): void {
    this._errorMessage = '';
    this._errorAction = '';
    this._onDidChangeTreeData.fire();
  }

  setLspStatus(status: 'starting' | 'running' | 'stopped' | 'error', message?: string): void {
    this._lspStatus = status;
    this._lspStatusMessage = message || this._getDefaultStatusMessage(status);
    this._onDidChangeTreeData.fire();
  }

  setMcpStatus(status: 'disabled' | 'starting' | 'running' | 'stopped' | 'error', message?: string): void {
    this._mcpStatus = status;
    this._mcpStatusMessage = message || this._getDefaultStatusMessage(status);
    this._onDidChangeTreeData.fire();
  }

  private _getDefaultStatusMessage(status: string): string {
    switch (status) {
      case 'starting': return 'Starting...';
      case 'running': return 'Running';
      case 'stopped': return 'Stopped';
      case 'error': return 'Error';
      case 'disabled': return 'Disabled';
      default: return '';
    }
  }

  /**
   * Rebuild all caches after file discovery to ensure stable TreeNode instances
   */
  private _rebuildNodeCaches(): void {
    // Clear all caches
    this._nodesByPath.clear();
    this._parentMap.clear();
    this._treeNodeCache.clear();
    this._sectionNodeCache.clear();
    this._baseNodeCache.clear();
    this._toolNodeCache.clear();

    // Pre-build all nodes for each base
    for (const baseEntry of this._bases) {
      // Create base node
      const featureCount = baseEntry.features ? this._countNodes(baseEntry.features) : 0;
      const bgCount = baseEntry.backgrounds ? this._countNodes(baseEntry.backgrounds) : 0;
      const baseNode = new TreeNode(
        'base',
        baseEntry.name,
        `${featureCount}f / ${bgCount}b`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      baseNode.baseEntry = baseEntry;
      this._baseNodeCache.set(baseEntry.name, baseNode);

      // Create section nodes and cache file nodes
      if (baseEntry.features) {
        const sectionKey = `${baseEntry.name}:features`;
        const sectionNode = new TreeNode(
          'section',
          'Features',
          `${this._countNodes(baseEntry.features)}`,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        sectionNode.dirNode = baseEntry.features;
        this._sectionNodeCache.set(sectionKey, sectionNode);
        this._parentMap.set(sectionNode, baseNode);
        this._preCacheDirNode(baseEntry.features, sectionNode);
      }
      if (baseEntry.backgrounds) {
        const sectionKey = `${baseEntry.name}:backgrounds`;
        const sectionNode = new TreeNode(
          'section',
          'Backgrounds',
          `${this._countNodes(baseEntry.backgrounds)}`,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        sectionNode.dirNode = baseEntry.backgrounds;
        this._sectionNodeCache.set(sectionKey, sectionNode);
        this._parentMap.set(sectionNode, baseNode);
        this._preCacheDirNode(baseEntry.backgrounds, sectionNode);
      }
    }
  }

  private _preCacheDirNode(dirNode: DirNode, parent: TreeNode | undefined): void {
    const treeNode = this._getOrCreateTreeNode(dirNode, parent);
    for (const child of dirNode.children) {
      this._preCacheDirNode(child, treeNode);
    }
  }

  /**
   * Get or create a stable TreeNode for a DirNode
   * Uses caching to ensure the same instance is returned for reveal() to work
   */
  private _getOrCreateTreeNode(node: DirNode, parent?: TreeNode): TreeNode {
    // Check cache first
    const cached = this._treeNodeCache.get(node.path);
    if (cached) {
      // Update parent mapping in case it changed
      if (parent) {
        this._parentMap.set(cached, parent);
      }
      return cached;
    }

    // Create new node
    let treeNode: TreeNode;
    if (node.isDir) {
      treeNode = new TreeNode(
        'folder',
        node.name,
        '',
        vscode.TreeItemCollapsibleState.Collapsed
      );
      treeNode.dirNode = node;
    } else {
      // Check if file is dirty (has unsaved changes)
      const uri = vscode.Uri.file(node.path);
      const isDirty = vscode.workspace.textDocuments.some(
        doc => doc.uri.fsPath === node.path && doc.isDirty
      );

      treeNode = new TreeNode(
        'file',
        isDirty ? `● ${node.name}` : node.name,
        '',
        vscode.TreeItemCollapsibleState.None,
        { command: 'vscode.open', title: 'Open File', arguments: [uri] }
      );
      treeNode.resourceUri = uri;
      treeNode.filePath = node.path;

      // Cache file nodes by path for reveal functionality
      this._nodesByPath.set(node.path, treeNode);
    }

    // Cache by DirNode path
    this._treeNodeCache.set(node.path, treeNode);

    if (parent) {
      this._parentMap.set(treeNode, parent);
    }

    return treeNode;
  }

  revealFile(filePath: string): boolean {
    const node = this._nodesByPath.get(filePath);
    if (node && this._treeView) {
      this._treeView.reveal(node, { select: true, focus: false, expand: true });
      return true;
    }
    return false;
  }

  private _discoverFiles(): void {
    const config = vscode.workspace.getConfiguration('haibun');
    const userBases = config.get<string[]>('bases') || [];
    const userCwd = config.get<string>('cwd') || '';
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    const effectiveCwd = userCwd
      ? (path.isAbsolute(userCwd) ? userCwd : path.resolve(workspaceRoot, userCwd))
      : workspaceRoot;

    this._bases = [];
    this._featureCount = 0;
    this._backgroundCount = 0;

    // User steppers are now set via setSteppers() from extension.ts
    // We don't load them here anymore.

    for (const base of userBases) {
      const baseDir = path.isAbsolute(base) ? base : path.resolve(effectiveCwd, base);
      const baseName = path.basename(base);

      const entry: BaseEntry = {
        name: baseName,
        features: null,
        backgrounds: null
      };

      // Look for features/ and backgrounds/ subdirectories
      const featuresDir = path.join(baseDir, 'features');
      const backgroundsDir = path.join(baseDir, 'backgrounds');

      if (fs.existsSync(featuresDir)) {
        entry.features = this._buildTree(featuresDir, false, baseName);
      }
      if (fs.existsSync(backgroundsDir)) {
        entry.backgrounds = this._buildTree(backgroundsDir, true, baseName);
      }

      // Also scan root for .feature files
      if (fs.existsSync(baseDir)) {
        const rootFeatures = this._scanRootFeatures(baseDir, baseName);
        if (rootFeatures.length > 0 && !entry.features) {
          entry.features = {
            name: 'features',
            path: baseDir,
            isDir: true,
            isBackground: false,
            baseName,
            children: rootFeatures
          };
        } else if (rootFeatures.length > 0 && entry.features) {
          entry.features.children.push(...rootFeatures);
        }
      }

      if (entry.features || entry.backgrounds) {
        this._bases.push(entry);
      }
    }
  }

  private _scanRootFeatures(dir: string, baseName: string): DirNode[] {
    const nodes: DirNode[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith('.feature') || entry.name.endsWith('.feature.ts'))) {
          nodes.push({
            name: entry.name,
            path: path.join(dir, entry.name),
            isDir: false,
            isBackground: false,
            baseName,
            children: []
          });
          this._featureCount++;
        }
      }
    } catch { /* ignore */ }
    return nodes;
  }

  private _buildTree(dir: string, isBackground: boolean, baseName: string): DirNode {
    const node: DirNode = {
      name: path.basename(dir),
      path: dir,
      isDir: true,
      isBackground,
      baseName,
      children: []
    };

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          node.children.push(this._buildTree(fullPath, isBackground, baseName));
        } else if (entry.name.endsWith('.feature') || entry.name.endsWith('.feature.ts')) {
          node.children.push({
            name: entry.name,
            path: fullPath,
            isDir: false,
            isBackground,
            baseName,
            children: []
          });
          if (isBackground) {
            this._backgroundCount++;
          } else {
            this._featureCount++;
          }
        }
      }
    } catch { /* ignore permission errors */ }

    // Sort: directories first, then files
    node.children.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    return node;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getParent(element: TreeNode): TreeNode | undefined {
    return this._parentMap.get(element);
  }

  getChildren(element?: TreeNode): Thenable<TreeNode[]> {
    if (element) {
      // Specifications Root Children
      if (element.isSpecificationsRoot) {
        if (this._bases.length === 1) {
          // Single base: show features/backgrounds directly
          const baseEntry = this._bases[0];
          const items: TreeNode[] = [];
          if (baseEntry.features) {
            const sectionKey = `${baseEntry.name}:features`;
            const node = this._sectionNodeCache.get(sectionKey);
            if (node) items.push(node);
          }
          if (baseEntry.backgrounds) {
            const sectionKey = `${baseEntry.name}:backgrounds`;
            const node = this._sectionNodeCache.get(sectionKey);
            if (node) items.push(node);
          }
          return Promise.resolve(items);
        } else {
          // Multiple bases: show base nodes
          const items: TreeNode[] = [];
          for (const baseEntry of this._bases) {
            const baseNode = this._baseNodeCache.get(baseEntry.name);
            if (baseNode) items.push(baseNode);
          }
          return Promise.resolve(items);
        }
      }

      // Return children of expandable nodes
      if (element.baseEntry) {
        // Show features and backgrounds under base - use cached section nodes
        const items: TreeNode[] = [];
        if (element.baseEntry.features) {
          const sectionKey = `${element.baseEntry.name}:features`;
          const sectionNode = this._sectionNodeCache.get(sectionKey);
          if (sectionNode) {
            items.push(sectionNode);
          }
        }
        if (element.baseEntry.backgrounds) {
          const sectionKey = `${element.baseEntry.name}:backgrounds`;
          const sectionNode = this._sectionNodeCache.get(sectionKey);
          if (sectionNode) {
            items.push(sectionNode);
          }
        }
        return Promise.resolve(items);
      }
      if (element.dirNode) {
        return Promise.resolve(
          element.dirNode.children.map(child => this._getOrCreateTreeNode(child, element))
        );
      }
      if (element.steppersList) {
        return Promise.resolve(
          element.steppersList.map(stepper => new TreeNode(
            'stepper',
            path.basename(stepper),
            stepper,
            vscode.TreeItemCollapsibleState.None
          ))
        );
      }
      // Group tools by stepper prefix
      if (element.isMcpToolsRoot) {
        const groups = new Map<string, McpTool[]>();
        for (const tool of this._mcpTools) {
          const stepperName = tool.name.split('-')[0];
          const list = groups.get(stepperName) || [];
          list.push(tool);
          groups.set(stepperName, list);
        }
        return Promise.resolve(
          Array.from(groups.keys()).sort().map(stepperName => {
            const node = new TreeNode(
              'stepper-tools-group',
              stepperName,
              `${(groups.get(stepperName) || []).length} tools`,
              vscode.TreeItemCollapsibleState.Collapsed
            );
            node.toolsList = groups.get(stepperName);
            return node;
          })
        );
      }
      if (element.toolsList) {
        return Promise.resolve(
          element.toolsList.map(tool => {
            const hasParams = Object.keys(tool.inputSchema?.properties || {}).length > 0;
            const node = new TreeNode(
              'mcp-tool',
              tool.name.split('-').slice(1).join('-'),
              tool.description,
              hasParams ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
              { command: 'haibun.executeMcpTool', title: 'Execute Tool', arguments: [tool] }
            );
            node.toolData = tool;
            return node;
          })
        );
      }
      if (element.nodeType === 'mcp-tool' && element.toolData) {
        const tool = element.toolData;
        const properties = tool.inputSchema?.properties || {};
        const children: TreeNode[] = [];

        // Add parameter nodes
        for (const [name, def] of Object.entries(properties)) {
          const value = this.getMcpParamValue(tool.name, name) || '';
          const node = new TreeNode(
            'mcp-tool-param',
            name,
            value,
            vscode.TreeItemCollapsibleState.None,
            { command: 'haibun.setMcpToolParam', title: 'Set Parameter', arguments: [tool.name, name] }
          );
          node.toolData = tool;
          node.mcpToolParam = { name, description: def.description };
          children.push(node);
        }

        // Add output node if there's a stored output
        const output = this.getToolOutput(tool.name);
        if (output) {
          const truncatedContent = output.content.length > 60
            ? output.content.substring(0, 60) + '...'
            : output.content;
          const label = output.isRunning ? 'Running...' : (output.isError ? 'Error' : 'Output');
          const node = new TreeNode(
            'mcp-tool-output',
            label,
            output.isRunning ? '' : truncatedContent.replace(/\n/g, ' '),
            vscode.TreeItemCollapsibleState.None
          );
          node.toolOutput = { content: output.content, isError: output.isError, isRunning: output.isRunning };
          node.tooltip = output.isRunning ? 'Executing...' : output.content;
          children.push(node);
        }

        return Promise.resolve(children);
      }
      // Common config section children
      if (element.commonConfig) {
        const { cwd, bases, configFile } = element.commonConfig;
        return Promise.resolve([
          new TreeNode(
            'config',
            'Working Directory',
            cwd || '(workspace root)',
            vscode.TreeItemCollapsibleState.None,
            { command: 'haibun.editCwd', title: 'Edit CWD' }
          ),
          new TreeNode(
            'config',
            'Base Directories',
            bases.length > 0 ? bases.join(', ') : '(none)',
            vscode.TreeItemCollapsibleState.None,
            { command: 'haibun.editBases', title: 'Edit Bases' }
          ),
          new TreeNode(
            'config',
            'Config File',
            configFile || '(none)',
            vscode.TreeItemCollapsibleState.None,
            { command: 'haibun.editConfigFile', title: 'Edit Config File' }
          )
        ]);
      }
      // MCP config section children
      if (element.mcpConfig) {
        const { mcpEnabled, mcpPort, mcpAccessToken } = element.mcpConfig;
        const items: TreeNode[] = [
          new TreeNode(
            'config',
            'Enabled',
            mcpEnabled ? 'Yes' : 'No',
            vscode.TreeItemCollapsibleState.None,
            { command: 'haibun.toggleMcp', title: 'Toggle MCP' }
          )
        ];
        if (mcpEnabled) {
          items.push(
            new TreeNode(
              'config',
              'Port',
              String(mcpPort),
              vscode.TreeItemCollapsibleState.None,
              { command: 'haibun.editMcpPort', title: 'Edit MCP Port' }
            ),
            new TreeNode(
              'config',
              'Access Token',
              mcpAccessToken ? '••••••••' : '(none - required)',
              vscode.TreeItemCollapsibleState.None,
              { command: 'haibun.editMcpAccessToken', title: 'Edit MCP Access Token' }
            )
          );
        }
        return Promise.resolve(items);
      }
      return Promise.resolve([]);
    }

    // Root level items
    const config = vscode.workspace.getConfiguration('haibun');
    const cwd = config.get<string>('cwd') || '';
    const bases = config.get<string[]>('bases') || [];
    const configFile = config.get<string>('configFile') || '';

    const items: TreeNode[] = [];

    // 1. Show Version info
    if (this._version) {
      items.push(new TreeNode(
        'info',
        'Haibun Extension',
        `v${this._version}`,
        vscode.TreeItemCollapsibleState.None
      ));
    }

    // 2. Show error prominently if present
    if (this._errorMessage) {
      const errorNode = new TreeNode(
        'error',
        this._errorMessage,
        this._errorAction,
        vscode.TreeItemCollapsibleState.None,
        { command: 'workbench.panel.output.focus', title: 'Show Output' }
      );
      items.push(errorNode);
    }

    // 3. Configuration Section (expanded by default)
    const configNode = new TreeNode(
      'section',
      'Configuration',
      '',
      vscode.TreeItemCollapsibleState.Expanded
    );
    configNode.commonConfig = { cwd, bases, configFile };
    items.push(configNode);

    // 4. LSP Section (no children)
    const lspStatusIcon = this._lspStatus === 'running' ? '●' :
      this._lspStatus === 'starting' ? '○' :
        this._lspStatus === 'error' ? '✕' : '○';
    const lspNode = new TreeNode(
      'section',
      'LSP',
      `${lspStatusIcon} ${this._lspStatusMessage}`,
      vscode.TreeItemCollapsibleState.None
    );
    items.push(lspNode);

    // 5. MCP Section (collapsible)
    const mcpEnabled = config.get<boolean>('mcpEnabled') ?? false;
    const mcpPort = config.get<number>('mcpPort') ?? 8765;
    const mcpAccessToken = config.get<string>('mcpAccessToken') || '';

    const mcpStatusIcon = this._mcpStatus === 'running' ? '●' :
      this._mcpStatus === 'starting' ? '○' :
        this._mcpStatus === 'error' ? '✕' :
          this._mcpStatus === 'disabled' ? '○' : '○';
    const mcpStatusDisplay = mcpEnabled
      ? `${mcpStatusIcon} ${this._mcpStatusMessage || 'port ' + mcpPort}`
      : '○ Disabled';
    const mcpNode = new TreeNode(
      'section',
      'MCP',
      mcpStatusDisplay,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    mcpNode.mcpConfig = { mcpEnabled, mcpPort, mcpAccessToken };
    items.push(mcpNode);

    // 6. Specifications Root
    const totalFeatures = this._featureCount;
    const totalBackgrounds = this._backgroundCount;

    const specsNode = new TreeNode(
      'section',
      'Specifications',
      `${totalFeatures}f / ${totalBackgrounds}b`,
      vscode.TreeItemCollapsibleState.Expanded
    );
    specsNode.isSpecificationsRoot = true;
    items.push(specsNode);

    // 8. MCP Tools (if running)
    if (this._mcpTools.length > 0) {
      const toolsNode = new TreeNode(
        'section',
        'MCP Tools',
        `${this._mcpTools.length}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      toolsNode.isMcpToolsRoot = true;
      items.push(toolsNode);
    }

    // 7. Steppers
    if (this._bundledSteppers.length > 0) {
      const node = new TreeNode(
        'steppers-section',
        'Bundled Steppers',
        `${this._bundledSteppers.length}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      node.steppersList = this._bundledSteppers;
      items.push(node);
    }

    if (this._configuredSteppers.length > 0) {
      const node = new TreeNode(
        'steppers-section',
        'Configured Steppers',
        `${this._configuredSteppers.length}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      node.steppersList = this._configuredSteppers;
      items.push(node);
    }

    return Promise.resolve(items);
  }

  private _countNodes(node: DirNode): number {
    let count = 0;
    for (const child of node.children) {
      if (child.isDir) {
        count += this._countNodes(child);
      } else {
        count++;
      }
    }
    return count;
  }

  /**
   * Find a TreeNode by file path (for reveal functionality)
   * Uses cached nodes - all nodes are pre-cached so this should always work
   */
  findNodeByPath(filePath: string): TreeNode | null {
    // Check cache
    const cached = this._nodesByPath.get(filePath);
    if (cached) return cached;

    // Not in cache - might be a file we don't know about
    return null;
  }
}

type NodeType = 'config' | 'base' | 'section' | 'folder' | 'file' | 'info' | 'steppers-section' | 'stepper' | 'error' | 'error-action' | 'stepper-tools-group' | 'mcp-tool' | 'mcp-tool-param' | 'mcp-tool-output';

class TreeNode extends vscode.TreeItem {
  public dirNode?: DirNode;
  public baseEntry?: BaseEntry;
  public steppersList?: string[];
  public filePath?: string;
  public commonConfig?: { cwd: string; bases: string[]; configFile: string };
  public mcpConfig?: { mcpEnabled: boolean; mcpPort: number; mcpAccessToken: string };
  public isSpecificationsRoot?: boolean;
  public isMcpToolsRoot?: boolean;
  public toolsList?: McpTool[];
  public toolData?: McpTool;
  public mcpToolParam?: { name: string; description?: string };
  public toolOutput?: { content: string; isError: boolean; isRunning?: boolean };

  constructor(
    public readonly nodeType: NodeType,
    public readonly label: string,
    public readonly value: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
    if (value) {
      this.description = value;
    }
    this.tooltip = nodeType === 'file' ? this.label : `${label}${value ? ': ' + value : ''}`;

    switch (nodeType) {
      case 'config':
        this.iconPath = new vscode.ThemeIcon('settings-gear');
        this.contextValue = 'configItem';
        break;
      case 'base':
        this.iconPath = new vscode.ThemeIcon('root-folder');
        this.contextValue = 'base';
        break;
      case 'section':
        this.iconPath = new vscode.ThemeIcon('folder-library');
        this.contextValue = 'section';
        break;
      case 'folder':
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'folder';
        break;
      case 'file':
        this.iconPath = new vscode.ThemeIcon('file');
        this.contextValue = 'featureFile';
        break;
      case 'info':
        this.iconPath = new vscode.ThemeIcon('info');
        this.contextValue = 'info';
        break;
      case 'steppers-section':
        this.iconPath = new vscode.ThemeIcon('extensions');
        this.contextValue = 'steppersSection';
        break;
      case 'stepper':
        this.iconPath = new vscode.ThemeIcon('symbol-method');
        this.contextValue = 'stepper';
        break;
      case 'stepper-tools-group':
        this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        this.contextValue = 'stepperToolsGroup';
        break;
      case 'mcp-tool':
        this.iconPath = new vscode.ThemeIcon('play');
        this.contextValue = 'mcpTool';
        break;
      case 'mcp-tool-param':
        this.iconPath = new vscode.ThemeIcon('symbol-parameter');
        this.contextValue = 'mcpToolParam';
        break;
      case 'mcp-tool-output':
        this.iconPath = new vscode.ThemeIcon(
          this.toolOutput?.isRunning ? 'sync~spin' :
            (this.toolOutput?.isError ? 'error' : 'output'),
          this.toolOutput?.isError ? new vscode.ThemeColor('errorForeground') : undefined
        );
        this.contextValue = 'mcpToolOutput';
        break;
      case 'error':
        this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
        this.contextValue = 'error';
        break;
      case 'error-action':
        this.iconPath = new vscode.ThemeIcon('lightbulb');
        this.contextValue = 'errorAction';
        break;
    }
  }
}

// Helper to register edit commands
export function registerConfigCommands(context: vscode.ExtensionContext, treeProvider: HaibunConfigurationTreeProvider) {
  context.subscriptions.push(
    vscode.commands.registerCommand('haibun.editCwd', async () => {
      const config = vscode.workspace.getConfiguration('haibun');
      const current = config.get<string>('cwd') || '';
      const result = await vscode.window.showInputBox({
        prompt: 'Working Directory (relative to workspace root)',
        value: current,
        placeHolder: 'e.g., e2e-tests'
      });
      if (result !== undefined) {
        await config.update('cwd', result, false);
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('haibun.editBases', async () => {
      const config = vscode.workspace.getConfiguration('haibun');
      const current = config.get<string[]>('bases') || [];
      const result = await vscode.window.showInputBox({
        prompt: 'Base Directories (comma-separated, relative to CWD)',
        value: current.join(', '),
        placeHolder: 'e.g., tests, ../shared'
      });
      if (result !== undefined) {
        const bases = result.split(',').map(s => s.trim()).filter(s => s.length > 0);
        await config.update('bases', bases, false);
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('haibun.editConfigFile', async () => {
      const config = vscode.workspace.getConfiguration('haibun');
      const current = config.get<string>('configFile') || '';
      const result = await vscode.window.showInputBox({
        prompt: 'Config File (relative to CWD)',
        value: current,
        placeHolder: 'e.g., config.json or tests/config.json'
      });
      if (result !== undefined) {
        await config.update('configFile', result, false);
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('haibun.toggleMcp', async () => {
      const config = vscode.workspace.getConfiguration('haibun');
      const current = config.get<boolean>('mcpEnabled') ?? false;
      await config.update('mcpEnabled', !current, false);
      treeProvider.refresh();
      vscode.window.showInformationMessage(`MCP Server ${!current ? 'enabled' : 'disabled'}`);
    }),

    vscode.commands.registerCommand('haibun.editMcpPort', async () => {
      const config = vscode.workspace.getConfiguration('haibun');
      const current = config.get<number>('mcpPort') ?? 8765;
      const result = await vscode.window.showInputBox({
        prompt: 'MCP Server Port',
        value: String(current),
        placeHolder: 'e.g., 8765',
        validateInput: (v) => /^\d+$/.test(v) && parseInt(v) > 0 ? undefined : 'Enter a valid port number'
      });
      if (result !== undefined) {
        await config.update('mcpPort', parseInt(result), false);
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('haibun.editMcpAccessToken', async () => {
      const config = vscode.workspace.getConfiguration('haibun');
      const current = config.get<string>('mcpAccessToken') || '';
      const result = await vscode.window.showInputBox({
        prompt: 'MCP Access Token (required for security)',
        value: current,
        placeHolder: 'Enter an access token',
        password: true
      });
      if (result !== undefined) {
        await config.update('mcpAccessToken', result, false);
        treeProvider.refresh();
      }
    }),
    vscode.commands.registerCommand('haibun.setMcpToolParam', async (toolName: string, paramName: string) => {
      const current = treeProvider.getMcpParamValue(toolName, paramName) || '';
      const result = await vscode.window.showInputBox({
        prompt: `Set value for ${paramName}`,
        value: current,
        placeHolder: 'Enter parameter value'
      });
      if (result !== undefined) {
        treeProvider.setMcpParamValue(toolName, paramName, result);
      }
    })
  );

  // Watch for document changes to update dirty indicators
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => treeProvider.refresh()),
    vscode.workspace.onDidSaveTextDocument(() => treeProvider.refresh())
  );

  // Watch for file system changes to update tree structure
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{feature,feature.ts}');
  context.subscriptions.push(watcher);
  watcher.onDidCreate(() => treeProvider.refresh());
  watcher.onDidDelete(() => treeProvider.refresh());
  // onDidChange is handled by onDidSaveTextDocument/onDidChangeTextDocument for active files,
  // but we can add it for external changes if needed. For now, Create/Delete covers the "missing file" issue.
}

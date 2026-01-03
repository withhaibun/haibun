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

export interface WorkspaceInfo {
  backgroundCount?: number;
  featureCount?: number;
  stepperCount?: number;
  base?: string;
}

export class HaibunConfigurationTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

  private _workspaceInfo: WorkspaceInfo = {};
  private _bases: BaseEntry[] = [];
  private _bundledSteppers: string[] = [];
  private _userSteppers: string[] = [];
  private _featureCount = 0;
  private _backgroundCount = 0;
  private _extensionPath: string = '';

  // For reveal support - cache nodes by file path
  private _nodesByPath: Map<string, TreeNode> = new Map();
  private _parentMap: Map<TreeNode, TreeNode | undefined> = new Map();
  // Cache TreeNodes by DirNode path to ensure stable instances
  private _treeNodeCache: Map<string, TreeNode> = new Map();
  // Cache section nodes (features, backgrounds) by base + type
  private _sectionNodeCache: Map<string, TreeNode> = new Map();
  // Cache base nodes by name
  private _baseNodeCache: Map<string, TreeNode> = new Map();

  setExtensionPath(extensionPath: string): void {
    this._extensionPath = extensionPath;
    this._loadBundledSteppers();
  }

  private _loadBundledSteppers(): void {
    if (!this._extensionPath) return;
    const bundledConfigPath = path.join(this._extensionPath, 'lsp-server', 'config.json');
    if (fs.existsSync(bundledConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(bundledConfigPath, 'utf-8'));
        this._bundledSteppers = config.steppers || [];
      } catch (e) { /* ignore */ }
    }
  }

  refresh(): void {
    this._discoverFiles();
    this._rebuildNodeCaches();
    this._onDidChangeTreeData.fire();
  }

  updateWorkspaceInfo(info: WorkspaceInfo): void {
    this._workspaceInfo = info;
    this._discoverFiles();
    this._rebuildNodeCaches();
    this._onDidChangeTreeData.fire();
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
          'features',
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
          'backgrounds',
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

  private _discoverFiles(): void {
    const config = vscode.workspace.getConfiguration('haibun');
    const userBases = config.get<string[]>('bases') || [];
    const userCwd = config.get<string>('cwd') || '';
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    const effectiveCwd = userCwd
      ? (path.isAbsolute(userCwd) ? userCwd : path.resolve(workspaceRoot, userCwd))
      : workspaceRoot;

    this._bases = [];
    this._userSteppers = [];
    this._featureCount = 0;
    this._backgroundCount = 0;

    // Load user steppers from config
    const userConfigFile = config.get<string>('configFile') || '';
    if (userConfigFile) {
      const configPath = path.isAbsolute(userConfigFile)
        ? userConfigFile
        : path.resolve(effectiveCwd, userConfigFile);
      if (fs.existsSync(configPath)) {
        try {
          const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          this._userSteppers = userConfig.steppers || [];
        } catch (e) { /* ignore */ }
      }
    }

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
    } catch (e) { /* ignore */ }
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
    } catch (e) { /* ignore permission errors */ }

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
      return Promise.resolve([]);
    }

    // Root level items
    const config = vscode.workspace.getConfiguration('haibun');
    const cwd = config.get<string>('cwd') || '';
    const bases = config.get<string[]>('bases') || [];
    const configFile = config.get<string>('configFile') || '';

    const items: TreeNode[] = [
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
    ];

    // Add each base as expandable section - use cached base nodes
    for (const baseEntry of this._bases) {
      const baseNode = this._baseNodeCache.get(baseEntry.name);
      if (baseNode) {
        items.push(baseNode);
      }
    }

    // Bundled steppers (expandable)
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

    // Configured steppers (expandable)
    if (this._userSteppers.length > 0) {
      const node = new TreeNode(
        'steppers-section',
        'Configured Steppers',
        `${this._userSteppers.length}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      node.steppersList = this._userSteppers;
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

type NodeType = 'config' | 'base' | 'section' | 'folder' | 'file' | 'info' | 'steppers-section' | 'stepper';

class TreeNode extends vscode.TreeItem {
  public dirNode?: DirNode;
  public baseEntry?: BaseEntry;
  public steppersList?: string[];
  public filePath?: string;

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

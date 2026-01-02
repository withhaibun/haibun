import { createConnection, TextDocuments, CompletionItem, CompletionItemKind, TextDocumentSyncKind, InitializeResult, Hover, MarkupKind, SemanticTokensBuilder, SemanticTokensLegend, SemanticTokensParams, SemanticTokens, Diagnostic, DiagnosticSeverity, Connection } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { AStepper } from '@haibun/core/lib/astepper.js';
import type { TWorld, TFeatureStep, TFeature, TStepAction, TFeatures } from '@haibun/core/lib/defs.js';
import { StepperRegistry, StepMetadata } from '@haibun/core/lib/stepper-registry.js';
import { Resolver } from '@haibun/core/phases/Resolver.js';
import { expand } from '@haibun/core/lib/features.js';
import { TStepValue } from '@haibun/core/schema/protocol.js';
import { findHaibunWorkspace, loadBackgroundsFromPath } from '@haibun/core/lib/workspace-discovery.js';

// Semantic token types - indices matter for the legend
const tokenTypes = ['keyword', 'function', 'parameter', 'string', 'number', 'comment'];
const tokenModifiers: string[] = [];
const legend: SemanticTokensLegend = { tokenTypes, tokenModifiers };

/**
 * Language Server Protocol stepper for Haibun IDE integration.
 * Provides autocomplete, hover, diagnostics, and semantic highlighting.
 */
export default class LspStepper extends AStepper {
  private connection: ReturnType<typeof createConnection> | null = null;
  private documents = new TextDocuments(TextDocument);
  private steppers: AStepper[] = [];
  private backgrounds: TFeature[] = [];

  // Cache of workspace-specific backgrounds: base path -> backgrounds
  private workspaceBackgrounds: Map<string, TFeature[]> = new Map();
  // Track current workspace info for VS Code status panel
  private currentWorkspace: { base: string; config: string | null; backgroundCount: number } | null = null;

  constructor(connection?: Connection, steppers?: AStepper[], backgrounds?: TFeatures) {
    super();
    this.steppers = steppers || [];
    this.backgrounds = backgrounds || [];
    if (connection) {
      this.connection = connection;
      this.setupLsp();
    }
  }

  steps = {
    lspIsReady: {
      gwta: 'lsp is ready',
      action: async () => {
        return { ok: true, message: 'LSP server is ready' };
      }
    }
  };

  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    // Ensure authoritative steppers list
    this.steppers = steppers;

    if (this.connection) return;

    world.eventLogger.suppressConsole = true;
    this.backgrounds = world.runtime.backgrounds || [];

    this.connection = createConnection(process.stdin, process.stdout);
    this.setupLsp();
  }

  private setupLsp() {
    if (!this.connection) return;

    this.connection.onInitialize((): InitializeResult => ({
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        completionProvider: { resolveProvider: true },
        hoverProvider: true,
        semanticTokensProvider: { legend, full: true }
      }
    }));

    // Validate documents when they change
    this.documents.onDidChangeContent(change => this.processDocument(change.document));

    // Autocomplete
    this.connection.onCompletion(() => {
      const metadata = StepperRegistry.getMetadata(this.steppers);
      return metadata.map(m => this.metadataToCompletionItem(m));
    });

    this.connection.onCompletionResolve((item: CompletionItem): CompletionItem => item);

    // Hover - use cached feature steps
    this.connection.onHover((params): Hover | null => {
      const uri = this.normalizePath(params.textDocument.uri);
      const cached = this.documentCache.get(uri);
      if (!cached) return null;

      const lineNum = params.position.line;
      const step = cached.featureSteps.find(s => s.source.lineNumber === lineNum + 1);

      if (step) {
        const stepValuesMap = step.action.stepValuesMap || {};
        const paramInfo = Object.entries(stepValuesMap)
          .map(([name, val]) => `- **${name}**: \`${val.term}\``)
          .join('\n') || 'None';
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: `### ${step.action.stepperName}\n\`${step.action.step.gwta || step.action.step.exact || 'custom'}\`\n\n**Parameters:**\n${paramInfo}`
          }
        };
      }
      return null;
    });

    // Semantic tokens - use cached feature steps
    this.connection.languages.semanticTokens.on((params: SemanticTokensParams): SemanticTokens => {
      const doc = this.documents.get(params.textDocument.uri);
      if (!doc) return { data: [] };

      const uri = this.normalizePath(params.textDocument.uri);

      const cached = this.documentCache.get(uri);
      const builder = new SemanticTokensBuilder();
      const lines = doc.getText().split('\n');

      // Build a map of lineNumber -> featureStep for quick lookup
      const stepsByLine = new Map<number, TFeatureStep>();
      const errorsByLine = new Map<number, string>();

      if (cached) {
        for (const step of cached.featureSteps) {
          if (step.source.lineNumber) {
            stepsByLine.set(step.source.lineNumber, step);
          }
        }
        for (const error of cached.errors) {
          if (error.lineNumber) {
            errorsByLine.set(error.lineNumber, error.message);
          }
        }
      }

      this.ensureStepperContext(uri);

      // Debug removed: stdout is reserved for LSP JSON-RPC protocol

      // Create resolver for recursive highlighting (only if we have valid backgrounds)
      let resolver: Resolver | null = null;
      try {
        resolver = new Resolver(this.steppers, this.backgrounds);
      } catch (e) {
        console.error(`[LspStepper] semanticTokens: Failed to create resolver: ${e}`);
      }

      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const trimmed = line.trim();
        if (!trimmed) continue;

        const startChar = line.indexOf(trimmed);
        const featureStep = stepsByLine.get(lineNum + 1); // lineNumber is 1-indexed

        if (featureStep) {
          this.highlightStep(builder, lineNum, line, startChar, featureStep.action, resolver, trimmed.length);
        } else {
          // Not a resolved step - check if prose
          const isProse = /^[A-Z]/.test(trimmed);
          if (isProse) {
            builder.push(lineNum, startChar, trimmed.length, tokenTypes.indexOf('comment'), 0);
          }
        }
      }

      return builder.build();
    });

    this.documents.listen(this.connection);
    this.connection.listen();
    // this.getWorld().eventLogger.info('LSP Stepper: Listening on stdio');
  }

  private highlightStep(
    builder: SemanticTokensBuilder,
    lineNum: number,
    lineText: string,
    startOffset: number,
    action: TStepAction | undefined,
    resolver: Resolver,
    length: number
  ) {
    if (!action) return;

    const stepValuesMap = action.stepValuesMap || {};
    const paramEntries = Object.entries(stepValuesMap);

    // Sort parameters by position
    const sortedParams: { val: { term: string; domain?: string }, pos: number }[] = [];
    if (paramEntries.length > 0) {
      for (const [, val] of paramEntries as [string, TStepValue][]) {
        if (val && val.term) {
          const pos = lineText.indexOf(val.term, startOffset);
          if (pos >= 0 && pos < startOffset + length) {
            sortedParams.push({ val, pos });
          }
        }
      }
      sortedParams.sort((a, b) => a.pos - b.pos);
    }

    let lastEnd = startOffset;
    const endOffset = startOffset + length;

    if (sortedParams.length > 0) {
      for (const { val, pos } of sortedParams) {
        if (pos > lastEnd) {
          builder.push(lineNum, lastEnd, pos - lastEnd, tokenTypes.indexOf('function'), 0);
        }

        if (val.domain === 'statement') {
          try {
            const nestedAction = resolver.findSingleStepAction(val.term);
            this.highlightStep(builder, lineNum, lineText, pos, nestedAction, resolver, val.term.length);
          } catch {
            // Fallback if statement resolution fails
            builder.push(lineNum, pos, val.term.length, tokenTypes.indexOf('parameter'), 0);
          }
        } else {
          const tokenType = val.domain === 'number' ? 'number' : 'parameter';
          builder.push(lineNum, pos, val.term.length, tokenTypes.indexOf(tokenType), 0);
        }
        lastEnd = pos + val.term.length;
      }

      if (lastEnd < endOffset) {
        builder.push(lineNum, lastEnd, endOffset - lastEnd, tokenTypes.indexOf('function'), 0);
      }
    } else {
      builder.push(lineNum, startOffset, length, tokenTypes.indexOf('function'), 0);
    }
  }

  // Cache for resolved feature steps per document
  private documentCache = new Map<string, {
    featureSteps: TFeatureStep[];
    errors: { lineNumber: number; message: string }[];
  }>();

  private ensureStepperContext(uri: string) {
    // Ensure steppers are aware of the current feature context (for dynamic steps like waypoints)
    interface IStepperWithResolution extends AStepper {
      startFeatureResolution(path: string): void;
    }
    for (const stepper of this.steppers) {
      if ('startFeatureResolution' in stepper) {
        (stepper as IStepperWithResolution).startFeatureResolution(uri);
      }
    }
  }

  private normalizePath(uriOrPath: string): string {
    let path = uriOrPath;
    if (path.startsWith('file://')) {
      path = path.replace('file://', '');
    }
    // minimal decoding for header specific encoding
    try {
      path = decodeURIComponent(path);
    } catch (e) {
      // ignore
    }
    return path;
  }

  private async updateBackgrounds(doc: TextDocument, uri: string): Promise<boolean> {
    const content = doc.getText();
    const normUri = this.normalizePath(uri);

    // Check if it's a background file by matching ActivitiesStepper logic (folder-based)
    const isBgFile = normUri.includes('/backgrounds/');

    // Check if we have any matching existing entry
    // match normalized paths
    const existingIndex = this.backgrounds.findIndex(b => this.normalizePath(b.path) === normUri || b.path.endsWith(normUri) || normUri.endsWith(b.path));

    if (isBgFile || existingIndex !== -1) {
      // Remove ALL matching entries to avoid duplicates/stale versions
      this.backgrounds = this.backgrounds.filter(b => {
        const bNorm = this.normalizePath(b.path);
        return !(bNorm === normUri || normUri.endsWith(bNorm) || bNorm.endsWith(normUri));
      });

      // Create authoritative new entry
      const name = normUri.split('/').pop() || 'background';
      this.backgrounds.push({
        name,
        path: normUri,
        content
      } as any);

      // Wholesale update: clear ALL background steps and re-register ALL backgrounds
      interface IActivitiesStepper extends AStepper {
        clearAllBackgroundSteps(): void;
      }
      for (const stepper of this.steppers) {
        if ('clearAllBackgroundSteps' in stepper) {
          (stepper as IActivitiesStepper).clearAllBackgroundSteps();
        }
      }

      // Re-parse ALL backgrounds to ensure consistency
      // We process them sequentially to ensure dependency order (if any) or just deterministic registration
      const resolver = new Resolver(this.steppers, []);
      for (const bg of this.backgrounds) {
        try {
          const expanded = await expand({ features: [bg], backgrounds: [] });
          await resolver.findFeatureStepsTolerant(expanded[0]);
        } catch (e) {
          // Error logged to stderr (safe for LSP)
          console.error(`[LspStepper] Failed to re-parse background ${bg.name}:`, e);
        }
      }

      return true;
    }
    return false;
  }

  /**
   * Get backgrounds for a document's workspace.
   * Discovers workspace by walking up from the feature file to find features/ parent.
   */
  private async getWorkspaceBackgrounds(uri: string): Promise<TFeature[]> {
    // Convert file:// URI to path
    const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;

    // Try to find the workspace for this document
    const workspace = findHaibunWorkspace(filePath);

    // Default to initial backgrounds/config if no workspace found
    if (!workspace) {
      this.currentWorkspace = {
        base: 'Default',
        config: null,
        backgroundCount: this.backgrounds.length,
      };
      this.sendWorkspaceInfo();
      return this.backgrounds;
    }

    // Always update status with discovered workspace info
    // Even if we don't find backgrounds/config, we should report the base
    this.currentWorkspace = {
      base: workspace.base,
      config: workspace.configPath,
      backgroundCount: 0, // Will update if we load them
    };

    // If no backgrounds path, just return default backgrounds but keep workspace info
    if (!workspace.backgroundsPath) {
      this.currentWorkspace.backgroundCount = this.backgrounds.length; // Or should this be 0? 
      // Actually if we fell back to defaults, might be confusing to show that in status.
      // But for now let's report what we found.
      this.sendWorkspaceInfo();
      return this.backgrounds;
    }

    // Check cache first
    if (this.workspaceBackgrounds.has(workspace.base)) {
      const bgs = this.workspaceBackgrounds.get(workspace.base)!;
      this.currentWorkspace.backgroundCount = bgs.length;
      this.sendWorkspaceInfo();
      return bgs;
    }

    // Load backgrounds from the discovered workspace
    try {
      const loadedBgs = await loadBackgroundsFromPath(workspace.backgroundsPath);
      const backgrounds: TFeature[] = loadedBgs.map(bg => ({
        ...bg,
        type: 'feature' as const,
      }));

      // Cache for future use
      this.workspaceBackgrounds.set(workspace.base, backgrounds);

      // Update info with actual count
      this.currentWorkspace.backgroundCount = backgrounds.length;
      this.sendWorkspaceInfo();

      return backgrounds;
    } catch (e) {
      console.error(`[LspStepper] Failed to load workspace backgrounds:`, e);
      // On error, send info with 0 count or error state?
      this.sendWorkspaceInfo();
      return this.backgrounds;
    }
  }

  /**
   * Send workspace info to VS Code client for status display
   */
  private sendWorkspaceInfo(): void {
    if (!this.connection || !this.currentWorkspace) return;

    this.connection.sendNotification('haibun/workspaceInfo', {
      base: this.currentWorkspace.base,
      config: this.currentWorkspace.config,
      backgroundCount: this.currentWorkspace.backgroundCount,
      stepperCount: this.steppers.length,
    });
  }

  /**
   * Process the document using Resolver.findFeatureStepsTolerant for full validation
   */
  private async processDocument(doc: TextDocument): Promise<void> {
    const content = doc.getText();
    // Use normalizePath for consistency
    const uri = this.normalizePath(doc.uri);

    // Check if this is a background file update
    const isBg = await this.updateBackgrounds(doc, uri);
    if (isBg) {
      // If background changed, revalidate all other open documents
      // We use setTimeout to avoid blocking the current processing or creating infinite loops if logic is flawed
      setTimeout(() => {
        this.documents.all().forEach(d => {
          if (this.normalizePath(d.uri) !== uri) {
            this.processDocument(d);
          }
        });
      }, 0);
    }

    // Create pseudo-feature
    const feature: TFeature = {
      base: '',
      path: uri,
      name: uri,
      content
    };

    // If we are processing a background file, do not apply backgrounds to it
    // This prevents recursive application (applying a background to itself) which causes "Duplicate definition" errors
    // and shifts line numbers. Backgrounds should be parsed as standalone lists of steps.
    // For non-background files, use workspace-relative backgrounds discovered from the file's location
    const backgroundsToApply = isBg ? [] : await this.getWorkspaceBackgrounds(uri);

    // Expand feature to handle compound statements
    // Wrap in try-catch to handle missing background includes gracefully
    let expandedFeatures;
    const expansionErrors: Diagnostic[] = [];

    try {
      expandedFeatures = await expand({ features: [feature], backgrounds: backgroundsToApply });
    } catch (e) {
      // Report the expansion error as a diagnostic (e.g., missing Backgrounds: include)
      const errorMessage = e instanceof Error ? e.message : String(e);

      // Try to find the line with the Backgrounds: directive that caused the issue
      const lines = content.split('\n');
      let bgLineNum = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('Backgrounds:')) {
          bgLineNum = i;
          break;
        }
      }

      expansionErrors.push({
        severity: DiagnosticSeverity.Warning,
        range: {
          start: { line: bgLineNum, character: 0 },
          end: { line: bgLineNum, character: lines[bgLineNum]?.length || 0 }
        },
        message: `Background not found (steps may be missing): ${errorMessage}`,
        source: 'haibun'
      });

      // Retry without backgrounds so we can still process the steps we know about
      try {
        expandedFeatures = await expand({ features: [feature], backgrounds: [] });
      } catch (e2) {
        // If even that fails, we can't do anything
        const errorMessage2 = e2 instanceof Error ? e2.message : String(e2);
        const diagnostics: Diagnostic[] = [{
          severity: DiagnosticSeverity.Error,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: `Failed to parse feature: ${errorMessage2}`,
          source: 'haibun'
        }];
        this.connection?.sendDiagnostics({ uri: doc.uri, diagnostics });
        this.documentCache.delete(uri);
        return;
      }
    }

    const pseudoFeature = expandedFeatures[0];

    this.ensureStepperContext(uri);

    // Create a fresh resolver with backgrounds (to register waypoints from backgrounds)
    // Resolver is now tolerant - it collects warnings instead of throwing
    const resolver = new Resolver(this.steppers, backgroundsToApply);

    // Log any background warnings (for debugging)
    if (resolver.backgroundWarnings.length > 0) {
      console.error(`[LspStepper] Background warnings:`, resolver.backgroundWarnings);
    }

    // Use tolerant resolution to get all valid steps and errors
    const { steps, errors } = await resolver.findFeatureStepsTolerant(pseudoFeature);

    // Debug removed: stdout is reserved for LSP JSON-RPC protocol

    // Map errors to diagnostics
    const diagnostics: Diagnostic[] = errors.map(({ featureLine, error }) => {
      const lineNum = (featureLine.lineNumber || 1) - 1;
      const lineText = featureLine.line;
      return {
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: lineNum, character: 0 },
          end: { line: lineNum, character: lineText.length }
        },
        message: error.message,
        source: 'haibun'
      };
    });

    // Cache valid steps for highlighting/hover
    // We map errors to a simpler format for the cache if needed, currently unused
    this.documentCache.set(uri, {
      featureSteps: steps,
      errors: errors.map(e => ({ lineNumber: e.featureLine.lineNumber || 0, message: e.error.message }))
    });

    // Debug removed: stdout is reserved for LSP JSON-RPC protocol

    // Publish diagnostics (including any expansion errors like missing backgrounds)
    this.connection?.sendDiagnostics({ uri: doc.uri, diagnostics: [...expansionErrors, ...diagnostics] });
  }

  private metadataToCompletionItem(meta: StepMetadata): CompletionItem {
    const snippet = StepperRegistry.patternToSnippet(meta.pattern);
    return {
      label: meta.pattern,
      kind: CompletionItemKind.Snippet,
      insertText: snippet,
      insertTextFormat: 2,
      detail: `From ${meta.stepperName}`,
      documentation: `Internal Name: ${meta.stepName}`
    };
  }
}

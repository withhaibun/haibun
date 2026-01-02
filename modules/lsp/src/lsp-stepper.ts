import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  CompletionItem,
  CompletionItemKind,
  TextDocumentSyncKind,
  InitializeResult,
  Hover,
  MarkupKind,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { AStepper } from '@haibun/core/lib/astepper.js';
import type { TWorld } from '@haibun/core/lib/defs.js';
import { StepperRegistry, StepMetadata } from '@haibun/core/lib/stepper-registry.js';

/**
 * Language Server Protocol stepper for Haibun IDE integration.
 * Provides autocomplete and hover documentation using the shared StepperRegistry.
 */
export default class LspStepper extends AStepper {
  private connection = createConnection(ProposedFeatures.all);
  private documents = new TextDocuments(TextDocument);
  private steppers: AStepper[] = [];

  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    this.steppers = steppers;

    this.connection.onInitialize((): InitializeResult => ({
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { resolveProvider: true },
        hoverProvider: true,
      }
    }));

    // Autocomplete provider
    this.connection.onCompletion(() => {
      const metadata = StepperRegistry.getMetadata(this.steppers);
      return metadata.map(m => this.metadataToCompletionItem(m));
    });

    // Completion resolve (provides additional details)
    this.connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
      return item;
    });

    // Hover provider - show stepper info when hovering over steps
    this.connection.onHover((params): Hover | null => {
      const doc = this.documents.get(params.textDocument.uri);
      if (!doc) return null;

      const line = doc.getText({
        start: { line: params.position.line, character: 0 },
        end: { line: params.position.line, character: 1000 }
      });

      const metadata = StepperRegistry.getMetadata(this.steppers);
      const match = this.findMatchingStep(line, metadata);

      if (match) {
        const paramList = Object.entries(match.params)
          .map(([name, type]) => `- **${name}**: \`${type}\``)
          .join('\n');

        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: `### ${match.stepperName}\n\`${match.pattern}\`\n\n**Parameters:**\n${paramList || 'None'}`
          }
        };
      }
      return null;
    });

    this.documents.listen(this.connection);
    this.connection.listen();
    this.getWorld().eventLogger.info('LSP Stepper: Listening on stdio');
  }

  /**
   * Convert step metadata to an LSP CompletionItem with snippet support.
   */
  private metadataToCompletionItem(meta: StepMetadata): CompletionItem {
    const snippet = StepperRegistry.patternToSnippet(meta.pattern);
    return {
      label: meta.pattern,
      kind: CompletionItemKind.Snippet,
      insertText: snippet,
      insertTextFormat: 2, // 2 = Snippet format
      detail: `From ${meta.stepperName}`,
      documentation: `Internal Name: ${meta.stepName}`
    };
  }

  /**
   * Find a step definition that matches the current line.
   * Uses a simple prefix match on the pattern.
   */
  private findMatchingStep(line: string, metadata: StepMetadata[]): StepMetadata | undefined {
    const trimmedLine = line.trim();
    return metadata.find(m => {
      // Match against the pattern prefix (before first variable placeholder)
      const prefix = m.pattern.split('{')[0].trim();
      return prefix.length > 0 && trimmedLine.includes(prefix);
    });
  }

  steps = {};
}

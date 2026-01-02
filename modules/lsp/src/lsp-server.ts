#!/usr/bin/env node
/**
 * Standalone LSP server that loads steppers from a config file.
 * Usage: node lsp-server.js --config ./path/to/config.json
 *
 * The config.json should have the same format as haibun configs.
 */
import { createConnection, TextDocuments, CompletionItem, CompletionItemKind, TextDocumentSyncKind, InitializeResult, Hover, MarkupKind } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { StepperRegistry, StepMetadata } from '@haibun/core/lib/stepper-registry.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { pathToFileURL } from 'url';

interface LspConfig {
  steppers: string[];
}

async function loadSteppersFromConfig(configPath: string): Promise<AStepper[]> {
  const configDir = dirname(resolve(configPath));
  const config: LspConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  const steppers: AStepper[] = [];

  for (const stepperPath of config.steppers) {
    try {
      let modulePath = stepperPath;
      if (stepperPath.startsWith('.')) {
        modulePath = pathToFileURL(resolve(configDir, stepperPath)).href;
      }
      const mod = await import(modulePath);
      const StepperClass = mod.default || mod;
      if (typeof StepperClass === 'function') {
        steppers.push(new StepperClass());
      }
    } catch (e) {
      console.error(`Failed to load stepper: ${stepperPath}`, e);
    }
  }
  return steppers;
}

async function main() {
  // Parse config path from args
  const configArg = process.argv.find(a => a.startsWith('--config='));
  const configPath = configArg?.split('=')[1] || process.argv[process.argv.indexOf('--config') + 1];

  if (!configPath) {
    console.error('Usage: lsp-server.js --config ./config.json');
    process.exit(1);
  }

  const steppers = await loadSteppersFromConfig(configPath);
  const metadata = StepperRegistry.getMetadata(steppers);

  // Use stdio for communication (required for standalone execution)
  const connection = createConnection(process.stdin, process.stdout);
  const documents = new TextDocuments(TextDocument);

  connection.onInitialize((): InitializeResult => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { resolveProvider: true },
      hoverProvider: true,
    }
  }));

  connection.onCompletion(() => {
    return metadata.map((m): CompletionItem => {
      const snippet = StepperRegistry.patternToSnippet(m.pattern);
      return {
        label: m.pattern,
        kind: CompletionItemKind.Snippet,
        insertText: snippet,
        insertTextFormat: 2,
        detail: `From ${m.stepperName}`,
        documentation: `Step: ${m.stepName}`,
      };
    });
  });

  connection.onCompletionResolve((item: CompletionItem): CompletionItem => item);

  connection.onHover((params): Hover | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const line = doc.getText({
      start: { line: params.position.line, character: 0 },
      end: { line: params.position.line, character: 1000 }
    });

    const match = findMatchingStep(line, metadata);
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

  function findMatchingStep(line: string, meta: StepMetadata[]): StepMetadata | undefined {
    const trimmedLine = line.trim();
    return meta.find(m => {
      const prefix = m.pattern.split('{')[0].trim();
      return prefix.length > 0 && trimmedLine.includes(prefix);
    });
  }

  documents.listen(connection);
  connection.listen();
  console.error(`Haibun LSP server started with ${metadata.length} steps from ${steppers.length} steppers`);
}

main().catch(e => {
  console.error('LSP server failed:', e);
  process.exit(1);
});

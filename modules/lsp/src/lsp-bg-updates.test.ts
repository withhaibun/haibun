import { describe, it, expect, vi } from 'vitest';
import { AStepper } from '@haibun/core/lib/astepper.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import LspStepper from './lsp-stepper.js';
import { TextDocument } from 'vscode-languageserver-textdocument';

// Mock connection
const mockConnection: any = {
  onInitialize: vi.fn(),
  onDidChangeContent: vi.fn(), // If used directly
  onDidOpenTextDocument: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidCloseTextDocument: vi.fn(),
  onDidSaveTextDocument: vi.fn(),
  onWillSaveTextDocument: vi.fn(),
  onWillSaveTextDocumentWaitUntil: vi.fn(),
  sendDiagnostics: vi.fn(),
  onCompletion: vi.fn(),
  onCompletionResolve: vi.fn(),
  onHover: vi.fn(),
  languages: {
    semanticTokens: {
      on: vi.fn()
    }
  },
  listen: vi.fn(),
  console: {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
};


// Mock World for stepper
const mockWorld = {
  eventLogger: { info: () => { }, warn: () => { }, error: () => { } }
};

describe('LspStepper Background Updates', () => {
  it('updates available steps when background file changes', async () => {
    const bgPath = '/tmp/backgrounds/test.bg.feature';
    // Note: Using file:// URI as LSP does
    const bgUri = 'file://' + bgPath;

    const bgContent1 = 'Activity: MyActivity\nwaypoint Foo';
    const bgContent2 = 'Activity: MyActivity\nwaypoint Bar';

    // Setup LspStepper with ActivitiesStepper
    const activitiesStepper = new ActivitiesStepper();
    // Manually initialize steps from baseSteps (simulating loader or constructor behavior?)
    (activitiesStepper as any).steps = (activitiesStepper as any).baseSteps;
    const steppers = [activitiesStepper];
    (activitiesStepper as any).setWorld(mockWorld, steppers);

    // Pass empty backgrounds initially (as if loading from scratch)
    // or pass one if we simulate startup. 
    // LspStepper should detect it regardless due to our fixes.
    const backgrounds: any[] = [];

    const lsp = new LspStepper(mockConnection, steppers, backgrounds);

    // 1. Process initial background
    const doc1 = TextDocument.create(bgUri, 'haibun', 1, bgContent1);

    // We can access private `processDocument` using casting
    await (lsp as any).processDocument(doc1);

    // Assert: "Foo" should be in backgroundSteps
    const stepsAfter1 = (activitiesStepper as any).backgroundSteps;
    expect(stepsAfter1['Foo']).toBeDefined();
    expect(stepsAfter1['Bar']).toBeUndefined();

    // 2. Process updated background
    // Same URI, new content
    const doc2 = TextDocument.create(bgUri, 'haibun', 2, bgContent2);
    await (lsp as any).processDocument(doc2);

    // Assert: "Foo" should be GONE. "Bar" should be present.
    const stepsAfter2 = (activitiesStepper as any).backgroundSteps;

    expect(stepsAfter2['Foo']).toBeUndefined();
    expect(stepsAfter2['Bar']).toBeDefined();
  });

  it('generates tokens for background file content', async () => {
    const bgPath = '/tmp/backgrounds/test.bg.feature';
    const bgUri = 'file://' + bgPath;

    // Realistic background content matching user's file
    const bgContent = `
Activity: foobar
;; Activity is semantically a function or method name.
set x to "ya"
waypoint Did foobar
`;

    const activitiesStepper = new ActivitiesStepper();
    (activitiesStepper as any).steps = (activitiesStepper as any).baseSteps;
    const steppers = [activitiesStepper];
    (activitiesStepper as any).setWorld(mockWorld, steppers);

    const backgrounds: any[] = [];
    const lsp = new LspStepper(mockConnection, steppers, backgrounds);

    const doc = TextDocument.create(bgUri, 'haibun', 1, bgContent);
    await (lsp as any).processDocument(doc);

    // Now check what's in the cache
    const uri = bgPath; // normalizePath strips file://
    const cached = (lsp as any).documentCache.get(uri);

    console.log('Background test - cached:', cached);
    console.log('Background test - featureSteps:', cached?.featureSteps?.length);
    if (cached?.featureSteps) {
      cached.featureSteps.forEach((step: any, i: number) => {
        console.log(`  Step ${i}: line=${step.source.lineNumber}, in="${step.in.trim()}"`);
      });
    }

    expect(cached).toBeDefined();
    expect(cached.featureSteps.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AStepper } from '@haibun/core/lib/astepper.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import LspStepper from './lsp-stepper.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { OK } from '@haibun/core/schema/protocol.js';

/**
 * Tests to ensure LSP server never writes raw output to stdout.
 * 
 * The LSP protocol uses stdout for JSON-RPC messages with Content-Length headers.
 * Any raw console.log() calls corrupt the protocol and cause:
 * "Header must provide a Content-Length property" errors in VS Code.
 * 
 * All debug output MUST go to stderr, not stdout.
 */

// Mock connection that captures all output
const createMockConnection = () => ({
  onInitialize: vi.fn(),
  onDidChangeContent: vi.fn(),
  onDidOpenTextDocument: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidCloseTextDocument: vi.fn(),
  onDidSaveTextDocument: vi.fn(),
  onWillSaveTextDocument: vi.fn(),
  onWillSaveTextDocumentWaitUntil: vi.fn(),
  sendDiagnostics: vi.fn(),
  sendNotification: vi.fn(),
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
});

const mockWorld = {
  eventLogger: { info: () => { }, warn: () => { }, error: () => { } }
};

class TestStepper extends AStepper {
  steps = {
    testStep: {
      gwta: 'test step with {param}',
      action: async () => OK,
    }
  };
}

describe('LSP stdout cleanliness', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any  
  let stderrSpy: any;

  beforeEach(() => {
    // Spy on process.stdout.write to catch any raw output
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('does not write to stdout when processing documents', async () => {
    const mockConnection = createMockConnection();
    const steppers = [new TestStepper()];
    const lsp = new LspStepper(mockConnection as any, steppers, []);

    const doc = TextDocument.create(
      'file:///test/feature.feature',
      'haibun',
      1,
      'test step with "hello"\ninvalid step that will error'
    );

    await (lsp as any).processDocument(doc);

    // Check no raw output went to stdout
    const stdoutCalls = stdoutSpy.mock.calls;
    expect(stdoutCalls.length).toBe(0);
  });

  it('does not write to stdout when generating semantic tokens', async () => {
    const mockConnection = createMockConnection();
    const activitiesStepper = new ActivitiesStepper();
    (activitiesStepper as any).steps = (activitiesStepper as any).baseSteps;
    const steppers = [activitiesStepper];
    (activitiesStepper as any).setWorld(mockWorld, steppers);

    const lsp = new LspStepper(mockConnection as any, steppers, []);

    // Get the semantic tokens handler
    const semanticTokensHandler = mockConnection.languages.semanticTokens.on.mock.calls[0]?.[0];
    if (!semanticTokensHandler) {
      throw new Error('Semantic tokens handler not registered');
    }

    const doc = TextDocument.create(
      'file:///test/feature.feature',
      'haibun',
      1,
      'set foo to "bar"'
    );

    // Process document first to populate cache
    await (lsp as any).processDocument(doc);

    // Access documents map directly to simulate LSP flow
    (lsp as any).documents = {
      get: () => doc
    };

    // Reset spy counts after document processing
    stdoutSpy.mockClear();

    // Now call semantic tokens
    const params = { textDocument: { uri: 'file:///test/feature.feature' } };
    semanticTokensHandler(params);

    // Check no raw output went to stdout
    const stdoutCalls = stdoutSpy.mock.calls;
    expect(stdoutCalls.length).toBe(0);
  });

  it('does not write to stdout when processing background files', async () => {
    const mockConnection = createMockConnection();
    const activitiesStepper = new ActivitiesStepper();
    (activitiesStepper as any).steps = (activitiesStepper as any).baseSteps;
    const steppers = [activitiesStepper];
    (activitiesStepper as any).setWorld(mockWorld, steppers);

    const lsp = new LspStepper(mockConnection as any, steppers, []);

    const bgDoc = TextDocument.create(
      'file:///test/backgrounds/test.bg.feature',
      'haibun',
      1,
      'Activity: TestActivity\nwaypoint TestWaypoint'
    );

    await (lsp as any).processDocument(bgDoc);

    // Check no raw output went to stdout
    const stdoutCalls = stdoutSpy.mock.calls;
    expect(stdoutCalls.length).toBe(0);
  });
});

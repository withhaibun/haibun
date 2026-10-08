import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { AStepper } from "@haibun/core/lib/astepper.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import LspStepper from "./lsp-stepper.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { OK } from "@haibun/core/schema/protocol.js";

/**
 * Checks that the LSP server doesn't write raw output to stdout.
 *
 * The LSP server sends JSON-RPC messages with Content-Length headers on stdout.
 * A raw console.log() call corrupts that message stream.
 * VS Code then reports the error "Header must provide a Content-Length property".
 *
 * The server writes debug output to stderr.
 */

// Each connection method is a vi.fn that records its calls.
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
	languages: { semanticTokens: { on: vi.fn() } },
	listen: vi.fn(),
	console: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
});

const mockWorld = {
	eventLogger: {
		info: () => {
			/* empty */
		},
		warn: () => {
			/* empty */
		},
		error: () => {
			/* empty */
		},
	},
};

class TestStepper extends AStepper {
	description = "Defines one step with one parameter for the language server to resolve.";
	steps = { testStep: { gwta: "test step with {param}", action: async () => OK } };
}

describe("LSP stdout cleanliness", () => {
	let stdoutSpy: MockInstance;
	let stderrSpy: MockInstance;

	beforeEach(() => {
		// Records each write to stdout and stderr and doesn't print it.
		stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	it("does not write to stdout when processing documents", async () => {
		const mockConnection = createMockConnection();
		const steppers = [new TestStepper()];
		// biome-ignore lint/suspicious/noExplicitAny: mock
		const lsp = new LspStepper(mockConnection as any, steppers, []);

		const doc = TextDocument.create("file:///test/feature.feature", "haibun", 1, 'test step with "hello"\ninvalid step that will error');

		// biome-ignore lint/suspicious/noExplicitAny: private
		await (lsp as any).processDocument(doc);

		const stdoutCalls = stdoutSpy.mock.calls;
		expect(stdoutCalls.length).toBe(0);
	});

	it("does not write to stdout when generating semantic tokens", () => {
		const mockConnection = createMockConnection();
		const activitiesStepper = new ActivitiesStepper();
		const base = (activitiesStepper as unknown as { baseSteps: unknown }).baseSteps;
		(activitiesStepper as unknown as { steps: unknown }).steps = base;
		const steppers = [activitiesStepper];
		(activitiesStepper as unknown as { setWorld: (w: unknown, s: unknown[]) => void }).setWorld(mockWorld, steppers);

		// biome-ignore lint/suspicious/noExplicitAny: mock
		const lsp = new LspStepper(mockConnection as any, steppers, []);

		// LspStepper registers the handler as the first argument of its first call to semanticTokens.on.
		const semanticTokensHandler = (mockConnection.languages.semanticTokens.on as unknown as MockInstance).mock.calls[0]?.[0];
		if (!semanticTokensHandler) {
			throw new Error("LspStepper didn't register a semantic tokens handler. Check the call to connection.languages.semanticTokens.on in setupLsp.");
		}

		const doc = TextDocument.create("file:///test/feature.feature", "haibun", 1, 'set foo to "bar"');

		// Replaces documents with a stub whose get returns doc. The document cache stays empty.
		(lsp as unknown as { processDocument: (d: TextDocument) => Promise<void>; documents: unknown }).documents = { get: () => doc };

		// Clears the writes recorded during setup.
		stdoutSpy.mockClear();

		const params = { textDocument: { uri: "file:///test/feature.feature" } };
		semanticTokensHandler(params);

		const stdoutCalls = stdoutSpy.mock.calls;
		expect(stdoutCalls.length).toBe(0);
	});

	it("does not write to stdout when processing background files", async () => {
		const mockConnection = createMockConnection();
		const activitiesStepper = new ActivitiesStepper();
		const base = (activitiesStepper as unknown as { baseSteps: unknown }).baseSteps;
		(activitiesStepper as unknown as { steps: unknown }).steps = base;
		const steppers = [activitiesStepper];
		(activitiesStepper as unknown as { setWorld: (w: unknown, s: unknown[]) => void }).setWorld(mockWorld, steppers);

		// biome-ignore lint/suspicious/noExplicitAny: mock
		const lsp = new LspStepper(mockConnection as any, steppers, []);

		const bgDoc = TextDocument.create("file:///test/backgrounds/test.bg.feature", "haibun", 1, "Activity: TestActivity\nwaypoint TestWaypoint");

		await (lsp as unknown as { processDocument: (d: TextDocument) => Promise<void> }).processDocument(bgDoc);

		const stdoutCalls = stdoutSpy.mock.calls;
		expect(stdoutCalls.length).toBe(0);
	});
});

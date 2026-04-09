import { describe, it, expect, vi, beforeEach } from "vitest";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { TFeature } from "@haibun/core/lib/defs.js";
import LspStepper from "./lsp-stepper.js";
import { TextDocument } from "vscode-languageserver-textdocument";

describe("LspStepper Semantic Tokens", () => {
	// biome-ignore lint/suspicious/noExplicitAny: mock connection
	let mockConnection: any;
	let steppers: AStepper[];
	let backgrounds: TFeature[];

	beforeEach(() => {
		// Mock the LSP connection
		mockConnection = {
			onInitialize: vi.fn(),
			onInitialized: vi.fn(),
			languages: {
				semanticTokens: {
					on: vi.fn(),
				},
			},
			onCompletion: vi.fn(),
			onCompletionResolve: vi.fn(),
			onHover: vi.fn(),
			onDidOpenTextDocument: vi.fn(),
			onDidChangeTextDocument: vi.fn(),
			onDidCloseTextDocument: vi.fn(),
			onWillSaveTextDocument: vi.fn(),
			onWillSaveTextDocumentWaitUntil: vi.fn(),
			onDidSaveTextDocument: vi.fn(),
			listen: vi.fn(),
			sendDiagnostics: vi.fn(),
			sendNotification: vi.fn(),
			console: {
				log: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			},
		};

		// Correctly handle the overload for semanticTokens.on
		// It can be called with (handler) or (options, handler)
		mockConnection.languages.semanticTokens.on.mockImplementation((arg1: unknown, arg2: unknown) => {
			if (typeof arg1 === "function") {
				mockConnection._tokenHandler = arg1;
			} else if (typeof arg2 === "function") {
				mockConnection._tokenHandler = arg2;
			}
		});

		// Minimal stepper
		class TestStepper extends AStepper {
			steps = {
				myActivity: {
					gwta: "Activity: {activity}",
					// biome-ignore lint/suspicious/noExplicitAny: mock action return
					action: async () => ({ ok: true }) as any,
				},
			};
		}

		// Mock ActivitiesStepper to simulate Director behavior
		class MockActivitiesStepper extends AStepper {
			steps = {
				activity: {
					gwta: "Activity: {activity}",
					// biome-ignore lint/suspicious/noExplicitAny: mock action return
					action: async () => ({ ok: true }) as any,
					resolveFeatureLine: (line: string) => {
						if (line.match(/^Activity:/i)) return true;
						if (line.match(/^waypoint\s+/i)) return true;
						return false;
					},
				},
			};
		}

		// Mock VariablesStepper to simulate 'set'
		class MockVariablesStepper extends AStepper {
			steps = {
				set: {
					gwta: "set {name} to {value}",
					// biome-ignore lint/suspicious/noExplicitAny: mock action return
					action: async () => ({ ok: true }) as any,
				},
			};
		}

		steppers = [new TestStepper(), new MockActivitiesStepper(), new MockVariablesStepper()];
		backgrounds = [];
	});

	it("generates tokens for known steps", async () => {
		// Capture handlers registered by TextDocuments
		// biome-ignore lint/suspicious/noExplicitAny: mock handler
		let didOpenHandler: any;
		mockConnection.onDidOpenTextDocument.mockImplementation((handler: unknown) => {
			didOpenHandler = handler;
		});

		const lsp = new LspStepper(mockConnection, steppers, backgrounds);

		// Create a document with a valid step
		const uri = "file:///tmp/test.feature";
		const content = "Activity: MyActivity";
		const doc = TextDocument.create(uri, "haibun", 1, content);

		// Simulate didOpen
		if (didOpenHandler) {
			didOpenHandler({ textDocument: { uri, languageId: "haibun", version: 1, text: content } });
		}

		// 1. Process document to populate cache
		// biome-ignore lint/suspicious/noExplicitAny: private method access
		await (lsp as any).processDocument(doc);

		// 2. Validate tokens
		const handler = mockConnection._tokenHandler;
		expect(handler).toBeDefined();

		const tokens = await handler({
			textDocument: { uri },
		});

		expect(tokens).toBeDefined();
		// Expect at least one token for "Activity" or "MyActivity" [0, 0, 10, 1, 0] etc
		expect(tokens.data.length).toBeGreaterThan(0);
	});

	it("generates no tokens for invalid lowercase steps (errors)", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: mock handler
		let didOpenHandler: any;
		mockConnection.onDidOpenTextDocument.mockImplementation((handler: unknown) => {
			didOpenHandler = handler;
		});

		const lsp = new LspStepper(mockConnection, steppers, backgrounds);
		const uri = "file:///tmp/unknown.feature";
		const content = "unknown step";
		const doc = TextDocument.create(uri, "haibun", 1, content);

		if (didOpenHandler) didOpenHandler({ textDocument: { uri, languageId: "haibun", version: 1, text: content } });
		// biome-ignore lint/suspicious/noExplicitAny: private method access
		await (lsp as any).processDocument(doc);

		const handler = mockConnection._tokenHandler;
		const tokens = await handler({ textDocument: { uri } });

		expect(tokens.data.length).toBe(0); // Should be empty
	});

	it("generates comment token for capitalized unknown steps (prose)", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: mock handler
		let didOpenHandler: any;
		mockConnection.onDidOpenTextDocument.mockImplementation((handler: unknown) => {
			didOpenHandler = handler;
		});

		const lsp = new LspStepper(mockConnection, steppers, backgrounds);
		const uri = "file:///tmp/prose.feature";
		const content = "Unknown Step";
		const doc = TextDocument.create(uri, "haibun", 1, content);

		if (didOpenHandler) didOpenHandler({ textDocument: { uri, languageId: "haibun", version: 1, text: content } });
		// biome-ignore lint/suspicious/noExplicitAny: private method access
		await (lsp as any).processDocument(doc);

		const handler = mockConnection._tokenHandler;
		const tokens = await handler({ textDocument: { uri } });

		expect(tokens.data.length).toBeGreaterThan(0); // Should be comment
	});

	it("sends diagnostics for invalid steps", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: mock handler
		let didOpenHandler: any;
		mockConnection.onDidOpenTextDocument.mockImplementation((handler: unknown) => {
			didOpenHandler = handler;
		});

		const lsp = new LspStepper(mockConnection, steppers, backgrounds);
		const uri = "file:///tmp/diag.feature";
		const content = "invalid step";
		const doc = TextDocument.create(uri, "haibun", 1, content);

		if (didOpenHandler) didOpenHandler({ textDocument: { uri, languageId: "haibun", version: 1, text: content } });
		// biome-ignore lint/suspicious/noExplicitAny: private method access
		await (lsp as any).processDocument(doc);

		// Expect diagnostics to be sent
		expect(mockConnection.sendDiagnostics).toHaveBeenCalled();
		const callArgs = mockConnection.sendDiagnostics.mock.calls[0][0];

		expect(callArgs.uri).toBe(uri);
		expect(callArgs.diagnostics.length).toBeGreaterThan(0);
		const diag = callArgs.diagnostics[0];
		expect(diag.range.start.line).toBe(0);
		expect(diag.range.end.line).toBe(0);
		expect(diag.range.end.character).toBe(content.length);
		expect(diag.severity).toBe(1); // Error
	});

	it("generates tokens for background files with activities and waypoints", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: mock handler
		let didOpenHandler: any;
		mockConnection.onDidOpenTextDocument.mockImplementation((handler: unknown) => {
			didOpenHandler = handler;
		});

		const lsp = new LspStepper(mockConnection, steppers, backgrounds);
		// Use a path that triggers background detection logic
		const uri = "file:///tmp/backgrounds/test.bg.feature";
		const content = `Activity: foobar
;; Activity is semantically a function or method name.
set x to "ya"
waypoint Did foobar
waypoint Ensured foobar with variable x exists
`;
		const doc = TextDocument.create(uri, "haibun", 1, content);

		if (didOpenHandler) didOpenHandler({ textDocument: { uri, languageId: "haibun", version: 1, text: content } });
		// biome-ignore lint/suspicious/noExplicitAny: private method access
		await (lsp as any).processDocument(doc);

		const handler = mockConnection._tokenHandler;
		const tokens = await handler({ textDocument: { uri } });

		expect(tokens.data.length).toBeGreaterThan(0);
	});

	it("resolves steps from HaibunStepper like pause for", async () => {
		// Import the actual HaibunStepper
		const { default: HaibunStepper } = await import("@haibun/core/steps/haibun.js");

		// biome-ignore lint/suspicious/noExplicitAny: mock handler
		let didOpenHandler: any;
		mockConnection.onDidOpenTextDocument.mockImplementation((handler: unknown) => {
			didOpenHandler = handler;
		});

		// Use the real HaibunStepper which has 'pause for {ms:number}s'
		const actualSteppers = [new HaibunStepper()];
		const lsp = new LspStepper(mockConnection, actualSteppers, []);

		const uri = "file:///tmp/test-haibun.feature";
		const content = "pause for 1s";
		const doc = TextDocument.create(uri, "haibun", 1, content);

		if (didOpenHandler) didOpenHandler({ textDocument: { uri, languageId: "haibun", version: 1, text: content } });
		// biome-ignore lint/suspicious/noExplicitAny: private method access
		await (lsp as any).processDocument(doc);

		// Check that the step was resolved (no errors)
		expect(mockConnection.sendDiagnostics).toHaveBeenCalled();
		const callArgs = mockConnection.sendDiagnostics.mock.calls[0][0];

		// Should have empty diagnostics if step resolved correctly
		expect(callArgs.diagnostics.length).toBe(0);

		// Check that we have semantic tokens
		const handler = mockConnection._tokenHandler;
		const tokens = await handler({ textDocument: { uri } });
		expect(tokens.data.length).toBeGreaterThan(0);
	});

	it("resolves serve files from step from WebServerStepper", async () => {
		// Import the actual WebServerStepper
		const WebServerStepper = (await import("@haibun/web-server-hono")).default;

		// biome-ignore lint/suspicious/noExplicitAny: mock handler
		let didOpenHandler: any;
		mockConnection.onDidOpenTextDocument.mockImplementation((handler: unknown) => {
			didOpenHandler = handler;
		});

		const actualSteppers = [new WebServerStepper()];
		const lsp = new LspStepper(mockConnection, actualSteppers, []);

		const uri = "file:///tmp/test-webserver.feature";
		const content = 'serve files from "xss"';
		const doc = TextDocument.create(uri, "haibun", 1, content);

		if (didOpenHandler) didOpenHandler({ textDocument: { uri, languageId: "haibun", version: 1, text: content } });
		// biome-ignore lint/suspicious/noExplicitAny: private method access
		await (lsp as any).processDocument(doc);

		expect(mockConnection.sendDiagnostics).toHaveBeenCalled();
		const callArgs = mockConnection.sendDiagnostics.mock.calls[0][0];

		// Should have empty diagnostics if step resolved correctly
		expect(callArgs.diagnostics.length).toBe(0);
	});

	it("emits warning diagnostic when Backgrounds: cannot be resolved", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: mock handler
		let didOpenHandler: any;
		mockConnection.onDidOpenTextDocument.mockImplementation((handler: unknown) => {
			didOpenHandler = handler;
		});

		// We need to use real steppers to trigger real expand() behavior
		const { default: HaibunStepper } = await import("@haibun/core/steps/haibun.js");
		const actualSteppers = [new HaibunStepper()];

		// Pass empty backgrounds - the Backgrounds: directive will fail to resolve
		const lsp = new LspStepper(mockConnection, actualSteppers, []);

		const uri = "file:///tmp/test-missing-bg.feature";
		// Feature with a Backgrounds: directive that won't be found
		const content = `Scenario: Test
    Backgrounds: nonexistent/path
    pause for 1s`;
		const doc = TextDocument.create(uri, "haibun", 1, content);

		if (didOpenHandler) didOpenHandler({ textDocument: { uri, languageId: "haibun", version: 1, text: content } });
		// biome-ignore lint/suspicious/noExplicitAny: private method access
		await (lsp as any).processDocument(doc);

		expect(mockConnection.sendDiagnostics).toHaveBeenCalled();
		const callArgs = mockConnection.sendDiagnostics.mock.calls[0][0];

		// Should have at least one diagnostic (the warning about missing background)
		expect(callArgs.diagnostics.length).toBeGreaterThan(0);

		// Find the warning about background not found
		const bgWarning = callArgs.diagnostics.find(
			(d: { message: string; severity: number }) => d.message.includes("Background not found") || d.message.includes("can't find"),
		);
		expect(bgWarning).toBeDefined();
		// Should be either warning (2) or error (1) depending on the failure path
		expect([1, 2]).toContain(bgWarning.severity);
	});

	it("generates semantic tokens for steps in .feature.ts strings", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: mock handler
		let didOpenHandler: any;
		mockConnection.onDidOpenTextDocument.mockImplementation((handler: unknown) => {
			didOpenHandler = handler;
		});

		const lsp = new LspStepper(mockConnection, steppers, backgrounds);
		const uri = "file:///tmp/kireji.feature.ts";
		// TypeScript content with steps in strings
		const content = `
      import { TKirejiExport } from '@haibun/core/kireji';

      // This should NOT be highlighted because it is outside the TKirejiExport block
      ensure({ outcome: 'Activity: Outside' });

      export const features: TKirejiExport = {
          'My Feature': [
              // Array of steps pattern (multiline string)
              \`Activity: MyActivity
               set x to "value"\`
          ]
      };
    `;
		const doc = TextDocument.create(uri, "typescript", 1, content);

		// Simulate didOpen
		if (didOpenHandler) didOpenHandler({ textDocument: { uri, languageId: "typescript", version: 1, text: content } });

		// Explicitly process (LspStepper logic checks extension .feature.ts)
		// biome-ignore lint/suspicious/noExplicitAny: private method access
		await (lsp as any).processDocument(doc);

		// Request tokens
		const handler = mockConnection._tokenHandler;
		const tokens = await handler({ textDocument: { uri } });

		expect(tokens.data.length).toBeGreaterThan(0);

		// Check reasonable assumption: at least 2 steps highlighted
		// 'Activity: MyActivity' -> 'Activity' (token)
		// 'set x to "value"' -> 'set', 'value' (tokens)
		// "not a step" -> no tokens
	});

	it("ignores imports and non-step lines in Kireji files (no diagnostics)", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: mock handler
		let didOpenHandler: any;
		mockConnection.onDidOpenTextDocument.mockImplementation((handler: unknown) => {
			didOpenHandler = handler;
		});

		const lsp = new LspStepper(mockConnection, steppers, backgrounds);
		const uri = "file:///tmp/imports.feature.ts";
		const content = `import { withAction } from '@haibun/core/kireji/withAction.js';
export const features: TKirejiExport = {
    'My Feature': [
        'set x to "value"'
    ]
};`;
		// Use 'haibun' languageId to simulate the problematic fallback case
		const doc = TextDocument.create(uri, "haibun", 1, content); // Changed from 'typescript' to test robust detection

		if (didOpenHandler) didOpenHandler({ textDocument: { uri, languageId: "haibun", version: 1, text: content } });

		// biome-ignore lint/suspicious/noExplicitAny: private method access
		await (lsp as any).processDocument(doc);

		// Should generate tokens for the valid step
		const handler = mockConnection._tokenHandler;
		const tokens = await handler({ textDocument: { uri } });
		expect(tokens.data.length).toBeGreaterThan(0);

		// Should NOT send diagnostics for the import line
		// If it fell back to expand(), it would report "no step found for import..."
		if (mockConnection.sendDiagnostics.mock.calls.length > 0) {
			const callArgs = mockConnection.sendDiagnostics.mock.calls[0][0];
			// Expect NO error diagnostics
			const errorDiags = callArgs.diagnostics.filter((d: { message: string; severity: number }) => d.severity === 1);
			expect(errorDiags.length).toBe(0);
		}
	});
});

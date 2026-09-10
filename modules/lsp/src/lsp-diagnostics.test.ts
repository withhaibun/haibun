import { describe, it, expect, vi, beforeEach } from "vitest";
import { AStepper } from "@haibun/core/lib/astepper.js";
import type { TFeature } from "@haibun/core/lib/execution.js";
import LspStepper from "./lsp-stepper.js";
import { TextDocument } from "vscode-languageserver-textdocument";

describe("LspStepper diagnostics", () => {
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

	it("emits warning diagnostic when Backgrounds: cannot be resolved", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: mock handler
		let didOpenHandler: any;
		mockConnection.onDidOpenTextDocument.mockImplementation((handler: unknown) => {
			didOpenHandler = handler;
		});

		// Real steppers are needed to trigger real expand() behavior
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
		const bgWarning = callArgs.diagnostics.find((d: { message: string; severity: number }) => d.message.includes("Background not found") || d.message.includes("can't find"));
		expect(bgWarning).toBeDefined();
		// Should be either warning (2) or error (1) depending on the failure path
		expect([1, 2]).toContain(bgWarning.severity);
	});
});

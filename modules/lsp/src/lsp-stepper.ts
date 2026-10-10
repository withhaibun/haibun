import { classifyDocument, TOKEN_TYPES } from "./semantic-tokens.js";
import ts from "typescript";
import {
	createConnection,
	TextDocuments,
	CompletionItem,
	CompletionItemKind,
	TextDocumentSyncKind,
	InitializeResult,
	Hover,
	MarkupKind,
	SemanticTokensBuilder,
	SemanticTokensLegend,
	SemanticTokensParams,
	SemanticTokens,
	Diagnostic,
	DiagnosticSeverity,
	Connection,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import { AStepper, type TFeatureStep, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import type { TFeature, TFeatures } from "@haibun/core/lib/execution.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { runRegistry } from "@haibun/core/lib/step-registry.js";
import type { TStepDescriptor } from "@haibun/core/lib/step-discovery.js";
import { Resolver } from "@haibun/core/phases/Resolver.js";
import { expand } from "@haibun/core/lib/features.js";
import { OK, TStepValue } from "@haibun/core/schema/protocol.js";
import { findHaibunWorkspace, loadBackgroundsFromPath, countFeatures } from "@haibun/core/lib/workspace-discovery.js";
import { constructorName, errorDetail } from "@haibun/core/lib/util/index.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

// The legend lists the token types in TOKEN_TYPES order. Each token encodes its type as an index into that order.
const tokenTypes = [...TOKEN_TYPES];
const tokenModifiers: string[] = [];
const legend: SemanticTokensLegend = { tokenTypes, tokenModifiers };

interface LCachedStep {
	step: TFeatureStep;
	startOffset?: number;
	length?: number;
}

interface ExecuteToolParams {
	name: string;
	arguments: Record<string, unknown>;
}

interface IMcpStepper {
	getTools?(): unknown[];
	executeTool?(name: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Implements the Language Server Protocol for haibun features in an IDE.
 * It provides completion, hover, diagnostics and semantic highlighting.
 */
export default class LspStepper extends AStepper {
	description = "Provides completion, hover, diagnostics and semantic highlighting for haibun features in an IDE.";

	private connection: ReturnType<typeof createConnection> | null = null;
	private documents = new TextDocuments(TextDocument);
	private steppers: AStepper[] = [];
	private backgrounds: TFeature[] = [];

	// Maps each workspace base path to the backgrounds loaded from that workspace.
	private workspaceBackgrounds: Map<string, TFeature[]> = new Map();
	// Holds the workspace info that sendWorkspaceInfo sends to the client. The VS Code extension shows it in its status bar and configuration panel.
	private currentWorkspace: { base: string; config: string | null; backgroundCount: number; featureCount?: number } | null = null;

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
			gwta: "lsp is ready",
			action: () => {
				return Promise.resolve(OK);
			},
		},
	} as const satisfies TStepperSteps;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		// The steppers passed to setWorld replace the constructor's steppers.
		this.steppers = steppers;

		if (this.connection) return;

		world.eventLogger.suppressConsole = true;
		this.backgrounds = world.runtime.backgrounds || [];

		this.connection = createConnection(process.stdin, process.stdout);
		this.setupLsp();
	}

	private setupLsp() {
		if (!this.connection) return;

		this.connection.onInitialize(
			(): InitializeResult => ({
				capabilities: {
					textDocumentSync: TextDocumentSyncKind.Full,
					completionProvider: { resolveProvider: true },
					hoverProvider: true,
					semanticTokensProvider: { legend, full: true },
				},
			}),
		);

		// Validates a document each time its content changes.
		this.documents.onDidChangeContent((change) => this.processDocument(change.document));

		// The completion handler lists each local step in actuality's step registry. It doesn't list a step that another process runs.
		this.connection.onCompletion(() =>
			runRegistry(this.getWorld())
				.list()
				.filter((tool) => tool.transport === "local")
				.map((tool) => completionItem(tool.descriptor)),
		);

		this.connection.onCompletionResolve((item: CompletionItem): CompletionItem => item);

		// The hover handler reads the document's cached feature steps.
		this.connection.onHover((params): Hover | null => {
			const uri = this.normalizePath(params.textDocument.uri);
			const cached = this.documentCache.get(uri);
			if (!cached) return null;

			const lineNum = params.position.line;
			// Selects the first cached step on the hovered line.
			// A step from a TypeScript document holds a column range. The hovered column must be within that range.
			const stepItem = cached.featureSteps.find((s) => {
				if (s.step.source?.lineNumber !== lineNum + 1) return false;
				if (s.startOffset !== undefined && s.length !== undefined) {
					const char = params.position.character;
					return char >= s.startOffset && char <= s.startOffset + s.length;
				}
				return true; // A step without a column range spans its whole line.
			});

			if (stepItem) {
				const step = stepItem.step;
				const stepValuesMap = step.action.stepValuesMap || {};
				const paramInfo =
					Object.entries(stepValuesMap)
						.map(([name, val]) => {
							// Reads the term of a TStepValue, else the value itself.
							const term = val && typeof val === "object" && "term" in val ? (val as TStepValue).term : val;
							return `- **${name}**: \`${term}\``;
						})
						.join("\n") || "None";
				return {
					contents: {
						kind: MarkupKind.Markdown,
						value: `### ${step.action.stepperName}\n\`${step.action.step.gwta || step.action.step.exact || "custom"}\`\n\n**Parameters:**\n${paramInfo}`,
					},
				};
			}
			return null;
		});

		// The semantic tokens handler reads the document's text and its cached feature steps.
		this.connection.languages.semanticTokens.on((params: SemanticTokensParams): SemanticTokens => {
			const doc = this.documents.get(params.textDocument.uri);
			if (!doc) return { data: [] };
			const uri = this.normalizePath(params.textDocument.uri);
			const cached = this.documentCache.get(uri);

			const stepsByLine = new Map<number, LCachedStep[]>();
			for (const item of cached?.featureSteps ?? []) {
				const lineNumber = item.step.source?.lineNumber;
				if (lineNumber) stepsByLine.set(lineNumber, [...(stepsByLine.get(lineNumber) ?? []), item]);
			}

			this.ensureStepperContext(uri);
			let resolver: Resolver | null = null;
			try {
				resolver = new Resolver(this.steppers, this.backgrounds);
			} catch (e) {
				console.error(`[LspStepper] semanticTokens: Failed to create resolver: ${e}. Nested statements are highlighted as plain arguments until this error is fixed.`);
			}

			const tokens = classifyDocument({
				lines: doc.getText().split("\n"),
				stepsByLine,
				prosePaintsAsComment: uri.endsWith(".feature"),
				resolveStatement: (statement) => {
					try {
						return resolver?.findSingleStepAction(statement);
					} catch {
						return undefined; // an unresolvable nested statement paints as a plain argument
					}
				},
			});

			const builder = new SemanticTokensBuilder();
			for (const t of tokens) builder.push(t.line, t.char, t.length, TOKEN_TYPES.indexOf(t.type), 0);
			return builder.build();
		});

		this.documents.listen(this.connection);
		this.connection.listen();
	}

	// Holds each document's resolved feature steps and errors, keyed by normalized path.
	private documentCache = new Map<string, { featureSteps: LCachedStep[]; errors: { lineNumber: number; message: string }[] }>();

	private ensureStepperContext(uri: string) {
		// Calls startFeatureResolution with the document path on each stepper that implements it.
		// ActivitiesStepper then removes the previous document's waypoints and adds this document's and the backgrounds' waypoints.
		interface IStepperWithResolution extends AStepper {
			startFeatureResolution(path: string): void;
		}
		for (const stepper of this.steppers) {
			if ("startFeatureResolution" in stepper) {
				(stepper as IStepperWithResolution).startFeatureResolution(uri);
			}
		}
	}

	private normalizePath(uriOrPath: string): string {
		let path = uriOrPath;
		if (path.startsWith("file://")) {
			path = path.replace("file://", "");
		}
		return decodeURIComponent(path);
	}

	private async updateBackgrounds(doc: TextDocument, uri: string): Promise<boolean> {
		const content = doc.getText();
		const normUri = this.normalizePath(uri);

		// A file in a backgrounds/ folder is a background. ActivitiesStepper applies the same rule.
		const isBgFile = normUri.includes("/backgrounds/");

		// Finds a loaded background with the document's normalized path. Either path may be a suffix of the other.
		const existingIndex = this.backgrounds.findIndex((b) => this.normalizePath(b.path) === normUri || b.path.endsWith(normUri) || normUri.endsWith(b.path));

		if (isBgFile || existingIndex !== -1) {
			// Removes every background with a matching path. The list then holds one current version of this file.
			this.backgrounds = this.backgrounds.filter((b) => {
				const bNorm = this.normalizePath(b.path);
				return !(bNorm === normUri || normUri.endsWith(bNorm) || bNorm.endsWith(normUri));
			});

			// Adds the document's current content as the background.
			const name = normUri.split("/").pop() || "background";
			this.backgrounds.push({ name, path: normUri, content } as TFeature);

			// Clears the background steps of each stepper that implements clearAllBackgroundSteps.
			// The loop below registers each background's waypoints again.
			interface IActivitiesStepper extends AStepper {
				clearAllBackgroundSteps(): void;
			}
			for (const stepper of this.steppers) {
				if ("clearAllBackgroundSteps" in stepper) {
					(stepper as IActivitiesStepper).clearAllBackgroundSteps();
				}
			}

			// Parses each background again in list order. Each parse registers that background's waypoints.
			const resolver = new Resolver(this.steppers, []);
			for (const bg of this.backgrounds) {
				try {
					const expanded = await expand({ features: [bg], backgrounds: [] });
					await resolver.findFeatureStepsTolerant(itemAt(expanded, 0));
				} catch (e) {
					// console.error writes to stderr. The LSP connection uses stdout.
					console.error(`[LspStepper] Failed to parse background ${bg.name}. Its waypoints aren't registered until this error is fixed:`, e);
				}
			}

			return true;
		}
		return false;
	}

	/**
	 * Returns the backgrounds of a document's workspace and sends the workspace info to the client.
	 * findHaibunWorkspace takes the parent of the nearest features/ or backgrounds/ folder in the file's path as the workspace base.
	 */
	private async getWorkspaceBackgrounds(uri: string): Promise<TFeature[]> {
		const filePath = uri.startsWith("file://") ? uri.slice(7) : uri;

		const workspace = findHaibunWorkspace(filePath);

		// A document outside a workspace uses this.backgrounds. It holds the backgrounds from the constructor or setWorld and each background document processed since.
		if (!workspace) {
			this.currentWorkspace = { base: "Default", config: null, backgroundCount: this.backgrounds.length };
			this.sendWorkspaceInfo();
			return this.backgrounds;
		}

		// The status shows the workspace base even when the workspace doesn't have backgrounds or a config.
		this.currentWorkspace = {
			base: workspace.base,
			config: workspace.configPath,
			backgroundCount: 0, // Each branch below sets the count. It stays 0 when loading fails.
		};

		// A workspace without a backgrounds/ folder uses this.backgrounds.
		if (!workspace.backgroundsPath) {
			this.currentWorkspace.backgroundCount = this.backgrounds.length;
			try {
				this.currentWorkspace.featureCount = await countFeatures(workspace.base);
			} catch (e) {
				console.error("[LspStepper] Failed to count features. The workspace status doesn't show a feature count:", e);
			}
			this.sendWorkspaceInfo();
			return this.backgrounds;
		}

		// Returns the cached backgrounds of a workspace read earlier.
		if (this.workspaceBackgrounds.has(workspace.base)) {
			const bgs = this.workspaceBackgrounds.get(workspace.base) || [];
			this.currentWorkspace.backgroundCount = bgs.length;
			try {
				this.currentWorkspace.featureCount = await countFeatures(workspace.base);
			} catch (e) {
				console.error("[LspStepper] Failed to count features. The workspace status doesn't show a feature count:", e);
			}
			this.sendWorkspaceInfo();
			return bgs;
		}

		// Loads and caches the workspace's backgrounds, then counts its features.
		try {
			const backgrounds = await loadBackgroundsFromPath(workspace.backgroundsPath);

			this.workspaceBackgrounds.set(workspace.base, backgrounds);

			this.currentWorkspace.backgroundCount = backgrounds.length;

			this.currentWorkspace.featureCount = await countFeatures(workspace.base);

			this.sendWorkspaceInfo();

			return backgrounds;
		} catch (e) {
			console.error(`[LspStepper] Failed to load the workspace backgrounds or count its features. The document resolves against the default backgrounds:`, e);
			// The status shows a background count of 0 when loadBackgroundsFromPath fails.
			this.sendWorkspaceInfo();
			return this.backgrounds;
		}
	}

	private sendWorkspaceInfo(): void {
		if (!this.connection || !this.currentWorkspace) return;

		const mcpStepper = this.steppers.find((s) => constructorName(s) === "McpStepper") as IMcpStepper | undefined;
		const mcpTools = mcpStepper?.getTools?.() || [];

		this.connection.sendNotification("haibun/workspaceInfo", {
			base: this.currentWorkspace.base,
			config: this.currentWorkspace.config,
			backgroundCount: this.currentWorkspace.backgroundCount,
			featureCount: this.currentWorkspace.featureCount,
			stepperCount: this.steppers.length,
			mcpTools,
		});

		if (this.connection.onRequest) {
			this.connection.onRequest("haibun/executeTool", async (params: ExecuteToolParams) => {
				if (!mcpStepper || !mcpStepper.executeTool) {
					throw new Error("McpStepper isn't loaded or doesn't implement executeTool. Load an McpStepper that implements executeTool to run a tool.");
				}
				return await mcpStepper.executeTool(params.name, params.arguments);
			});
		}
	}

	/**
	 * Validates a document and sends its diagnostics.
	 * Resolver.findFeatureStepsTolerant resolves a feature document. processTypeScriptDocument handles a TypeScript document.
	 */
	private async processDocument(doc: TextDocument): Promise<void> {
		const content = doc.getText();
		const uri = this.normalizePath(doc.uri);

		// Treats a document as TypeScript when its language id is typescript or typescriptreact, its path ends in .ts, or its text contains a Kireji type name.
		const isTs =
			doc.languageId === "typescript" ||
			doc.languageId === "typescriptreact" ||
			uri.toLowerCase().endsWith(".ts") ||
			content.includes("TKirejiStep") ||
			content.includes("TKirejiExport");

		if (isTs) {
			await this.processTypeScriptDocument(doc, uri);
			return;
		}

		// Updates the backgrounds when the document is a background file.
		const isBg = await this.updateBackgrounds(doc, uri);
		if (isBg) {
			// Revalidates every other open document after a background changes.
			// setTimeout schedules the revalidation in a later task. The revalidation doesn't recurse within this call.
			setTimeout(() => {
				this.documents.all().forEach((d) => {
					if (this.normalizePath(d.uri) !== uri) {
						void this.processDocument(d);
					}
				});
			}, 0);
		}

		// Wraps the document text as a feature.
		const feature: TFeature = { base: "", path: uri, name: uri, content };

		// A background file expands and resolves without backgrounds. updateBackgrounds registered its waypoints from its current content.
		// Every other file uses the backgrounds that getWorkspaceBackgrounds returns.
		const backgroundsToApply = isBg ? [] : await this.getWorkspaceBackgrounds(uri);

		// Replaces each Backgrounds: line with the lines of the backgrounds it names.
		let expandedFeatures;
		const expansionErrors: Diagnostic[] = [];

		try {
			expandedFeatures = await expand({ features: [feature], backgrounds: backgroundsToApply });
		} catch (e) {
			// Records a warning diagnostic. Only a Backgrounds: line fails the expansion.
			// The line fails when a name in it doesn't match exactly one background.
			const errorMessage = errorDetail(e);

			// Places the warning on the first Backgrounds: line, else on the first line.
			const lines = content.split("\n");
			const bgLineNum = Math.max(
				0,
				lines.findIndex((line) => line.trim().startsWith("Backgrounds:")),
			);

			expansionErrors.push({
				severity: DiagnosticSeverity.Warning,
				range: { start: { line: bgLineNum, character: 0 }, end: { line: bgLineNum, character: lines[bgLineNum]?.length || 0 } },
				message: `Background not found: ${errorMessage}. Change the Backgrounds: line to name an existing background.`,
				source: "haibun",
			});

			// Expands again without backgrounds. A Backgrounds: line fails this expansion too.
			try {
				expandedFeatures = await expand({ features: [feature], backgrounds: [] });
			} catch (e2) {
				// Sends one error diagnostic on the first line and discards the warning. Removes the document's cached steps.
				const errorMessage2 = errorDetail(e2);
				const diagnostics: Diagnostic[] = [
					{
						severity: DiagnosticSeverity.Error,
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
						message: `Failed to parse feature: ${errorMessage2}. Change the Backgrounds: line to name an existing background.`,
						source: "haibun",
					},
				];
				this.connection?.sendDiagnostics({ uri: doc.uri, diagnostics });
				this.documentCache.delete(uri);
				return;
			}
		}

		const pseudoFeature = itemAt(expandedFeatures, 0);

		this.ensureStepperContext(uri);

		// A new Resolver registers the waypoints that the backgrounds declare.
		// A background line that doesn't resolve becomes an entry in resolver.backgroundWarnings.
		const resolver = new Resolver(this.steppers, backgroundsToApply);

		if (resolver.backgroundWarnings.length > 0) {
			console.error(`[LspStepper] Background warnings:`, resolver.backgroundWarnings);
		}

		// Resolves every valid step and collects each error without throwing.
		const { steps, errors } = await resolver.findFeatureStepsTolerant(pseudoFeature);

		const diagnostics: Diagnostic[] = errors.map(({ featureLine, error }) => {
			const lineNum = (featureLine.lineNumber || 1) - 1;
			const lineText = featureLine.line;
			return {
				severity: DiagnosticSeverity.Error,
				range: { start: { line: lineNum, character: 0 }, end: { line: lineNum, character: lineText.length } },
				message: error.message,
				source: "haibun",
			};
		});

		// Caches the valid steps for semantic tokens and hover.
		this.documentCache.set(uri, {
			featureSteps: steps.map((s) => ({ step: s })),
			errors: errors.map((e) => ({ lineNumber: e.featureLine.lineNumber || 0, message: e.error.message })),
		});

		// Sends the expansion warnings and the resolution errors as diagnostics.
		this.connection?.sendDiagnostics({ uri: doc.uri, diagnostics: [...expansionErrors, ...diagnostics] });
	}

	private processTypeScriptDocument(doc: TextDocument, uri: string): Promise<void> {
		const fullText = doc.getText();
		// A file without a Kireji type name isn't parsed. Its diagnostics are cleared.
		if (!fullText.includes("TKirejiStep") && !fullText.includes("TKirejiExport")) {
			this.connection?.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
			return Promise.resolve();
		}

		const featureSteps: LCachedStep[] = [];
		const diagnostics: Diagnostic[] = [];
		this.ensureStepperContext(uri);
		const resolver = new Resolver(this.steppers, []);

		const sourceFile = ts.createSourceFile(uri, fullText, ts.ScriptTarget.Latest, true);

		const processString = (node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression) => {
			const start = node.getStart(sourceFile);
			const text = node.getText(sourceFile);
			if (text.length < 2) return;

			// Removes the literal's opening and closing quotes.
			const rawContent = text.slice(1, -1);
			const contentStartOffset = start + 1;

			// Resolves each line of the literal as a separate step. An empty line and a line that starts with # are skipped.
			const lines = rawContent.split(/\r?\n/);
			let currentOffsetInString = 0;

			for (const line of lines) {
				const trimmed = line.trim();
				const leadingSpaces = line.indexOf(trimmed);

				if (trimmed.length > 0 && !trimmed.startsWith("#")) {
					this.connection?.console.log(`[LSP] Processing string line: "${trimmed}"`);
					const stepStartAbs = contentStartOffset + currentOffsetInString + (leadingSpaces >= 0 ? leadingSpaces : 0);
					const pos = doc.positionAt(stepStartAbs);
					const endPos = doc.positionAt(stepStartAbs + trimmed.length);

					try {
						const match = resolver.findSingleStepAction(trimmed);
						if (!match) {
							this.connection?.console.log(`[LSP] "${trimmed}" doesn't match a step`);
						} else {
							this.connection?.console.log(`[LSP] Match found: ${match.actionName}`);
						}
						if (match && match.actionName) {
							const step: TFeatureStep = { action: match, source: { lineNumber: pos.line + 1, path: uri }, in: trimmed, seqPath: [0] };
							featureSteps.push({ step, startOffset: pos.character, length: trimmed.length });
						} else {
							// findSingleStepAction throws for a line that doesn't resolve to one step. This branch doesn't run.
						}
					} catch (_e) {
						// A line that doesn't resolve to one step becomes an error diagnostic.
						diagnostics.push({ severity: DiagnosticSeverity.Error, range: { start: pos, end: endPos }, message: `'${trimmed}' doesn't resolve to one step.`, source: "haibun" });
					}
				}

				// Advances the offset past the line and its line ending.
				currentOffsetInString += line.length;
				if (currentOffsetInString < rawContent.length) {
					if (rawContent.slice(currentOffsetInString, currentOffsetInString + 2) === "\r\n") {
						currentOffsetInString += 2;
					} else if (["\n", "\r"].includes(rawContent.slice(currentOffsetInString, currentOffsetInString + 1))) {
						currentOffsetInString += 1;
					}
				}
			}
		};

		const processArray = (node: ts.ArrayLiteralExpression) => {
			for (const el of node.elements) {
				if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el) || ts.isTemplateExpression(el)) {
					processString(el);
				}
			}
		};

		const tryProcessStep = (node: ts.Node) => {
			if (ts.isArrayLiteralExpression(node)) {
				processArray(node);
			} else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
				processString(node);
			}
		};

		const processObject = (node: ts.ObjectLiteralExpression) => {
			for (const prop of node.properties) {
				if (ts.isPropertyAssignment(prop)) {
					tryProcessStep(prop.initializer);
				}
			}
		};

		const visit = (node: ts.Node) => {
			// Selects a variable whose declared type is a reference to TKirejiStep or TKirejiExport.
			// This check skips a variable typed TKirejiStep[]. TypeScript parses that type as an array type, not a type reference.
			if (ts.isVariableDeclaration(node) && node.type && ts.isTypeReferenceNode(node.type) && node.initializer) {
				const typeName = node.type.typeName.getText(sourceFile);
				this.connection?.console.log(`[LSP] Found variable ${node.name.getText(sourceFile)} of type ${typeName}`);

				if (typeName.includes("TKirejiStep")) {
					tryProcessStep(node.initializer);
				} else if (typeName.endsWith("TKirejiExport")) {
					if (ts.isObjectLiteralExpression(node.initializer)) {
						processObject(node.initializer);
					}
				}
			}

			// Selects a cast to TKirejiStep or TKirejiStep[].
			if (ts.isAsExpression(node) && node.type) {
				const typeText = node.type.getText(sourceFile);
				if (typeText.includes("TKirejiStep")) {
					this.connection?.console.log(`[LSP] Found cast to ${typeText}`);
					tryProcessStep(node.expression);
				}
			}

			ts.forEachChild(node, visit);
		};

		visit(sourceFile);

		// Caches the steps and errors for semantic tokens and hover.
		this.documentCache.set(uri, { featureSteps, errors: diagnostics.map((e) => ({ lineNumber: e.range.start.line + 1, message: e.message })) });

		this.connection?.sendDiagnostics({ uri: doc.uri, diagnostics });
		return Promise.resolve();
	}
}

/** Converts a step's pattern to an LSP snippet. Each placeholder becomes a numbered tab stop: `{name}` and `{name: number}` become `${1:name}`. */
export function patternToSnippet(pattern: string): string {
	let i = 1;
	return pattern.replace(/\{(\w+)(?::\s*\w+)?\}/g, (_, name) => `\${${i++}:${name}}`);
}

/**
 * Converts a step to a completion item. The label is the step's pattern. The insert text is the pattern as a snippet.
 * The detail names the step's stepper. The documentation names the step.
 */
export function completionItem(step: TStepDescriptor): CompletionItem {
	return {
		label: step.pattern,
		kind: CompletionItemKind.Snippet,
		insertText: patternToSnippet(step.pattern),
		insertTextFormat: 2,
		detail: `From ${step.stepperName}`,
		documentation: `Internal Name: ${step.stepName}`,
	};
}

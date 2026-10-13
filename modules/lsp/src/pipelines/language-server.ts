/**
 * The language server: it resolves each document the editor opens or changes against actuality's steppers and the
 * backgrounds of the document's workspace, sends the document's diagnostics, and holds the steps it resolved, which its
 * hover and its semantic tokens read. A background document's change registers its waypoints again and validates every
 * other open document.
 */
import { TextDocumentSyncKind, type Diagnostic, type InitializeResult } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { AStepper, TFeatureStep } from "@haibun/core/lib/astepper.js";
import type { TExpandedFeature, TExpandedLine, TFeature } from "@haibun/core/lib/execution.js";
import { runRegistry } from "@haibun/core/lib/step-registry.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { Resolver } from "@haibun/core/phases/Resolver.js";
import { expand } from "@haibun/core/lib/features.js";
import { constructorName, errorDetail } from "@haibun/core/lib/util/index.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { OUTSIDE_A_WORKSPACE, TOKEN_TYPES, type TExecuteToolParams, type TPlacedStep, type TToken, type TWorkspaceStatus } from "../domains/lsp.js";
import { completionItem } from "../derivations/completion.js";
import { backgroundNotFound, unresolvedLine, unresolvedString } from "../derivations/diagnostics.js";
import { fileNameOf, isBackgroundPath, isTypeScript, namesKirejiType, pathOf, samePath } from "../derivations/documents.js";
import { hoverOf, stepAt } from "../derivations/hover.js";
import { kirejiLines } from "../derivations/kireji-lines.js";
import { classifyDocument } from "../derivations/semantic-tokens.js";
import type { TLspHandlers, TLspLog, TLspPorts, TWorkspace } from "../ports.js";

/** The capabilities the server states to the editor: full document sync, completion, hover and semantic tokens. */
const CAPABILITIES: InitializeResult = {
	capabilities: {
		textDocumentSync: TextDocumentSyncKind.Full,
		completionProvider: { resolveProvider: true },
		hoverProvider: true,
		semanticTokensProvider: { legend: { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [] }, full: true },
	},
};
const FEATURE_EXTENSION = ".feature";
const MCP_STEPPER = "McpStepper";

/** A stepper that resolves a document's waypoints: the activities stepper. */
type TResolvesFeatures = AStepper & { startFeatureResolution(path: string): void };
/** A stepper that holds the backgrounds' waypoints: the activities stepper. */
type THoldsBackgroundSteps = AStepper & { clearAllBackgroundSteps(): void };
/** A stepper that lists and calls tools: the MCP stepper. */
type TCallsTools = AStepper & { getTools?(): unknown[]; executeTool?(name: string, args: Record<string, unknown>): Promise<unknown> };

/** An expanded line's number, which expansion states for each line of a feature and of a background it includes. */
function lineNumberOf({ lineNumber, line, feature }: TExpandedLine): number {
	if (lineNumber === undefined) throw new Error(`the line "${line}" of ${feature.path} was expanded without its number, which expansion states for each line`);
	return lineNumber;
}

const resolvesFeatures = (stepper: AStepper): stepper is TResolvesFeatures => "startFeatureResolution" in stepper;
const holdsBackgroundSteps = (stepper: AStepper): stepper is THoldsBackgroundSteps => "clearAllBackgroundSteps" in stepper;

export type TLanguageServerContext = {
	ports: TLspPorts;
	/** The world, whose step registry completion lists. */
	world: TWorld;
	steppers: AStepper[];
	/** The backgrounds a document outside a workspace resolves against, which a background document's change replaces. */
	backgrounds: TFeature[];
	log: TLspLog;
};

export class LanguageServer {
	readonly #ports: TLspPorts;
	readonly #world: TWorld;
	readonly #steppers: AStepper[];
	readonly #log: TLspLog;
	#backgrounds: TFeature[];
	/** Each workspace's backgrounds, by its base, once read. */
	readonly #workspaceBackgrounds = new Map<string, TFeature[]>();
	/** Each document's resolved steps, by its path, which its hover and its semantic tokens read. */
	readonly #placed = new Map<string, TPlacedStep[]>();

	constructor({ ports, world, steppers, backgrounds, log }: TLanguageServerContext) {
		this.#ports = ports;
		this.#world = world;
		this.#steppers = steppers;
		this.#backgrounds = backgrounds;
		this.#log = log;
	}

	/** Registers each handler with the editor's connection, once, and starts reading its messages. */
	listen(): void {
		const handlers: TLspHandlers = {
			initialize: () => CAPABILITIES,
			// A step another process runs isn't listed: the editor completes the steps this process resolves.
			completion: () =>
				runRegistry(this.#world)
					.list()
					.filter((tool) => tool.transport === "local")
					.map((tool) => completionItem(tool.descriptor)),
			hover: ({ textDocument, position }) => {
				const placed = this.#placed.get(pathOf(textDocument.uri));
				const step = placed === undefined ? undefined : stepAt(placed, position.line, position.character);
				return step === undefined ? null : hoverOf(step);
			},
			semanticTokens: (uri) => this.semanticTokens(uri).map(({ type, ...span }) => ({ ...span, typeIndex: TOKEN_TYPES.indexOf(type) })),
			executeTool: (params) => this.#executeTool(params),
			changed: (document) => void this.processDocument(document),
		};
		this.#ports.connection.listen(handlers);
	}

	/** The steps a document resolved, by its path, where it was processed. */
	placedSteps(path: string): TPlacedStep[] | undefined {
		return this.#placed.get(path);
	}

	/** The tokens a document paints: its resolved steps as calls with their arguments, and a `.feature`'s unresolved capitalized lines as prose. */
	semanticTokens(uri: string): TToken[] {
		const document = this.#ports.connection.document(uri);
		if (document === undefined) return [];
		const path = pathOf(uri);
		const stepsByLine = new Map<number, TPlacedStep[]>();
		const held = this.#placed.get(path);
		for (const placed of held === undefined ? [] : held) {
			const lineNumber = placed.step.source?.lineNumber;
			if (lineNumber === undefined) continue;
			const onLine = stepsByLine.get(lineNumber);
			if (onLine === undefined) stepsByLine.set(lineNumber, [placed]);
			else onLine.push(placed);
		}
		this.#startResolution(path);
		const resolver = this.#resolver([]);
		return classifyDocument({
			lines: document.getText().split("\n"),
			stepsByLine,
			prosePaintsAsComment: path.endsWith(FEATURE_EXTENSION),
			resolveStatement: (statement) => {
				// A nested statement that doesn't resolve paints as a plain argument.
				if (resolver === undefined) return undefined;
				try {
					return resolver.findSingleStepAction(statement);
				} catch {
					return undefined;
				}
			},
		});
	}

	/** Resolves a document, holds the steps it resolved, and sends its diagnostics. */
	async processDocument(document: TextDocument): Promise<void> {
		const text = document.getText();
		const path = pathOf(document.uri);
		if (isTypeScript(document.languageId, path, text)) return this.#processKireji(document, path, text);
		const isBackground = await this.#updateBackgrounds(path, text);
		// A background's change validates every other open document, in a later turn, so a validation doesn't recurse within this one.
		if (isBackground) this.#ports.clock.later(() => this.#revalidateAllBut(path));
		// A background resolves without backgrounds: its own waypoints were registered from its current text.
		const backgrounds = isBackground ? [] : await this.#backgroundsFor(path);
		const feature: TFeature = { base: "", path, name: path, content: text };
		const expansion = await this.#expanded(feature, backgrounds);
		if ("refusal" in expansion) {
			this.#placed.delete(path);
			this.#ports.connection.sendDiagnostics(document.uri, [expansion.refusal]);
			return;
		}
		this.#startResolution(path);
		const resolver = new Resolver(this.#steppers, backgrounds);
		if (resolver.backgroundWarnings.length > 0) this.#log.warn(`[LspStepper] a background line of ${path} doesn't resolve: ${JSON.stringify(resolver.backgroundWarnings)}`);
		const { steps, errors } = await resolver.findFeatureStepsTolerant(expansion.feature);
		this.#placed.set(
			path,
			steps.map((step) => ({ step })),
		);
		const unresolved = errors.map(({ featureLine, error }) => unresolvedLine(lineNumberOf(featureLine), featureLine.line, error.message));
		this.#ports.connection.sendDiagnostics(document.uri, unresolved);
	}

	/** The feature with the backgrounds its Backgrounds: lines name, or an error on the Backgrounds: line where a background it names isn't found. */
	async #expanded(feature: TFeature, backgrounds: TFeature[]): Promise<{ feature: TExpandedFeature } | { refusal: Diagnostic }> {
		try {
			return { feature: itemAt(await expand({ features: [feature], backgrounds }), 0) };
		} catch (e) {
			return { refusal: backgroundNotFound(feature.content, errorDetail(e)) };
		}
	}

	/** Resolves each step line a kireji document writes, and sends an error for each line that doesn't resolve to one step.
	 *  A TypeScript document that doesn't name a kireji type isn't a feature, and its diagnostics are cleared. */
	#processKireji(document: TextDocument, path: string, text: string): void {
		if (!namesKirejiType(text)) {
			this.#ports.connection.sendDiagnostics(document.uri, []);
			return;
		}
		this.#startResolution(path);
		const resolver = new Resolver(this.#steppers, []);
		const placed: TPlacedStep[] = [];
		const diagnostics: Diagnostic[] = [];
		for (const line of kirejiLines(path, text)) {
			const start = document.positionAt(line.offset);
			try {
				const action = resolver.findSingleStepAction(line.text);
				const step: TFeatureStep = { action, source: { lineNumber: start.line + 1, path }, in: line.text, seqPath: [0] };
				placed.push({ step, startOffset: start.character, length: line.text.length });
				this.#log.debug(`[LspStepper] "${line.text}" resolves to ${action.actionName}`);
			} catch {
				diagnostics.push(unresolvedString({ start, end: document.positionAt(line.offset + line.text.length) }, line.text));
			}
		}
		this.#placed.set(path, placed);
		this.#ports.connection.sendDiagnostics(document.uri, diagnostics);
	}

	/** Where `path` is a background, holds its current text as the background and registers every background's waypoints again. */
	async #updateBackgrounds(path: string, content: string): Promise<boolean> {
		const held = this.#backgrounds.some((background) => samePath(pathOf(background.path), path));
		if (!isBackgroundPath(path) && !held) return false;
		// The list holds one current version of each background.
		this.#backgrounds = [...this.#backgrounds.filter((background) => !samePath(pathOf(background.path), path)), { base: "", name: fileNameOf(path), path, content }];
		for (const stepper of this.#steppers) if (holdsBackgroundSteps(stepper)) stepper.clearAllBackgroundSteps();
		// Each background's resolution registers its waypoints, in the list's order.
		const resolver = new Resolver(this.#steppers, []);
		for (const background of this.#backgrounds) {
			try {
				await resolver.findFeatureStepsTolerant(itemAt(await expand({ features: [background], backgrounds: [] }), 0));
			} catch (e) {
				this.#log.error(`[LspStepper] the background ${background.name} doesn't parse, so its waypoints aren't registered: ${errorDetail(e)}`);
			}
		}
		return true;
	}

	/** The backgrounds a document resolves against, and the status of its workspace sent to the editor: a document outside a
	 *  workspace, or in one without a backgrounds directory, resolves against the server's backgrounds. */
	async #backgroundsFor(path: string): Promise<TFeature[]> {
		const workspace = this.#ports.workspaces.find(path);
		if (workspace === undefined) {
			this.#sendWorkspaceInfo({ base: OUTSIDE_A_WORKSPACE, config: null, backgroundCount: this.#backgrounds.length });
			return this.#backgrounds;
		}
		const backgrounds = await this.#workspaceBackgroundsOf(workspace);
		const featureCount = await this.#countFeatures(workspace.base);
		this.#sendWorkspaceInfo({ base: workspace.base, config: workspace.configPath, backgroundCount: backgrounds.length, ...(featureCount === undefined ? {} : { featureCount }) });
		return backgrounds;
	}

	/** A workspace's backgrounds, read once and held by its base. A workspace whose backgrounds don't load resolves against the server's. */
	async #workspaceBackgroundsOf({ base, backgroundsPath }: TWorkspace): Promise<TFeature[]> {
		if (backgroundsPath === null) return this.#backgrounds;
		const held = this.#workspaceBackgrounds.get(base);
		if (held !== undefined) return held;
		try {
			const read = await this.#ports.workspaces.backgrounds(backgroundsPath);
			this.#workspaceBackgrounds.set(base, read);
			return read;
		} catch (e) {
			this.#log.error(`[LspStepper] the backgrounds at ${backgroundsPath} don't load, so the document resolves against the server's backgrounds: ${errorDetail(e)}`);
			return this.#backgrounds;
		}
	}

	/** How many features a workspace holds, or undefined where they can't be counted, which the status then leaves out. */
	async #countFeatures(base: string): Promise<number | undefined> {
		try {
			return await this.#ports.workspaces.countFeatures(base);
		} catch (e) {
			this.#log.error(`[LspStepper] the features of ${base} can't be counted, so the workspace status leaves out a feature count: ${errorDetail(e)}`);
			return undefined;
		}
	}

	#sendWorkspaceInfo(status: TWorkspaceStatus): void {
		const tools = this.#toolStepper()?.getTools?.();
		this.#ports.connection.sendWorkspaceInfo({ ...status, stepperCount: this.#steppers.length, mcpTools: tools === undefined ? [] : tools });
	}

	#toolStepper(): TCallsTools | undefined {
		return this.#steppers.find((stepper) => constructorName(stepper) === MCP_STEPPER) as TCallsTools | undefined;
	}

	async #executeTool({ name, arguments: args }: TExecuteToolParams): Promise<unknown> {
		const stepper = this.#toolStepper();
		if (stepper?.executeTool === undefined)
			throw new Error(`the tool ${name} isn't run: actuality doesn't hold an ${MCP_STEPPER} that runs tools, which a config that lists one loads`);
		return await stepper.executeTool(name, args);
	}

	#revalidateAllBut(path: string): void {
		for (const document of this.#ports.connection.documents()) if (pathOf(document.uri) !== path) void this.processDocument(document);
	}

	/** Starts each stepper's resolution of the document: the activities stepper then holds this document's waypoints and the backgrounds'. */
	#startResolution(path: string): void {
		for (const stepper of this.#steppers) if (resolvesFeatures(stepper)) stepper.startFeatureResolution(path);
	}

	/** A resolver over the steppers and backgrounds, or undefined where one can't be made, which leaves nested statements painted as arguments. */
	#resolver(backgrounds: TFeature[]): Resolver | undefined {
		try {
			return new Resolver(this.#steppers, backgrounds);
		} catch (e) {
			this.#log.error(`[LspStepper] a resolver can't be made, so nested statements paint as plain arguments: ${errorDetail(e)}`);
			return undefined;
		}
	}
}

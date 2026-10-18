/** What the language server reads and writes through: the editor's connection and its documents, the workspace on disk, and a clock that runs a task later. */
import type { CompletionItem, Diagnostic, Hover, HoverParams, InitializeResult } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TFeature } from "@haibun/core/lib/execution.js";
import type { findHaibunWorkspace } from "@haibun/core/lib/adapters/workspace-discovery.js";
import type { TExecuteToolParams, TWorkspaceStatus } from "./domains/lsp.js";

/** A painted span as the protocol encodes it: its line, where it starts, how long it is, and its type's index in the legend. */
export type TEncodedToken = { line: number; char: number; length: number; typeIndex: number };

/** The handlers of the editor's requests. */
export type TLspHandlers = {
	initialize(): InitializeResult;
	completion(): CompletionItem[];
	hover(params: HoverParams): Hover | null;
	/** The tokens a document paints, each type as its index in the legend `initialize` states. */
	semanticTokens(uri: string): TEncodedToken[];
	executeTool(params: TExecuteToolParams): Promise<unknown>;
	/** A document the editor opened or changed. */
	changed(document: TextDocument): void;
};

/** The editor's connection and the documents it holds open. */
export type TLspConnection = {
	/** Registers each handler once and starts reading the editor's messages. */
	listen(handlers: TLspHandlers): void;
	sendDiagnostics(uri: string, diagnostics: Diagnostic[]): void;
	sendWorkspaceInfo(info: TWorkspaceStatus & { stepperCount: number; mcpTools: unknown[] }): void;
	document(uri: string): TextDocument | undefined;
	documents(): TextDocument[];
};

/** A workspace a document is in: its base, its config and its backgrounds directory, where it has them. */
export type TWorkspace = NonNullable<ReturnType<typeof findHaibunWorkspace>>;

/** The workspaces on disk: the one a document is in, its backgrounds, and how many features it holds. */
export type TWorkspaces = { find(path: string): TWorkspace | undefined; backgrounds(backgroundsPath: string): Promise<TFeature[]>; countFeatures(base: string): Promise<number> };

/** A clock that runs a task in a later turn of the event loop. */
export type TClock = { later(task: () => void): void };

/** What the language server logs: the world's logger. */
export type TLspLog = { debug(message: string): void; warn(message: string): void; error(message: string): void };

/** The ports the root builds for the language server. */
export type TLspPorts = { connection: TLspConnection; workspaces: TWorkspaces; clock: TClock };

/** The editor's connection over the process's standard input and output, with the documents it holds open. */
import { createConnection, SemanticTokensBuilder, TextDocuments, type Connection } from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { TLspConnection } from "../ports.js";

/** The methods beside the protocol's own: the workspace status the server sends, and the tool call the editor makes. */
const WORKSPACE_INFO = "haibun/workspaceInfo";
const EXECUTE_TOOL = "haibun/executeTool";

/** The connection over `connection`, which the root makes over the process's standard input and output. */
export function lspConnection(connection: Connection): TLspConnection {
	const documents = new TextDocuments(TextDocument);
	return {
		listen(handlers) {
			connection.onInitialize(handlers.initialize);
			connection.onCompletion(handlers.completion);
			connection.onCompletionResolve((item) => item);
			connection.onHover(handlers.hover);
			connection.languages.semanticTokens.on(({ textDocument }) => {
				const builder = new SemanticTokensBuilder();
				for (const { line, char, length, typeIndex } of handlers.semanticTokens(textDocument.uri)) builder.push(line, char, length, typeIndex, 0);
				return builder.build();
			});
			connection.onRequest(EXECUTE_TOOL, handlers.executeTool);
			documents.onDidChangeContent(({ document }) => handlers.changed(document));
			documents.listen(connection);
			connection.listen();
		},
		sendDiagnostics: (uri, diagnostics) => void connection.sendDiagnostics({ uri, diagnostics }),
		sendWorkspaceInfo: (info) => void connection.sendNotification(WORKSPACE_INFO, info),
		document: (uri) => documents.get(uri),
		documents: () => documents.all(),
	};
}

/** The connection over the process's standard input and output, where the editor starts the server. */
export const stdioConnection = (): TLspConnection => lspConnection(createConnection(process.stdin, process.stdout));

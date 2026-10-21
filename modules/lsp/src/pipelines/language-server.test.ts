/**
 * The language server over fake ports: the diagnostics it sends, the steps it holds for a document, the waypoint heads it
 * completes, the head its hover shows at the line that applies it, the backgrounds a background document's change registers, the workspace status it counts once per document, the tool handler it
 * registers once, and the logger it writes to in place of standard output.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Diagnostic } from "vscode-languageserver/node.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import type { TFeature } from "@haibun/core/lib/execution.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { openRunRegistry } from "@haibun/core/lib/step-registry.js";
import { registerDomains, registerStepperNames } from "@haibun/core/lib/domains.js";
import { constructorName } from "@haibun/core/lib/domains/util.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import ActivitiesStepper, { savedWaypointDomainDefinition } from "@haibun/core/steps/activities-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import { OK } from "@haibun/core/lib/domains/protocol.js";
import { OUTSIDE_A_WORKSPACE } from "../domains/lsp.js";
import type { TLspConnection, TLspHandlers, TLspLog, TWorkspace, TWorkspaces } from "../ports.js";
import { LanguageServer } from "./language-server.js";

class SampleStepper extends AStepper {
	description = "Steps that set a variable and take one argument, for the language server to resolve.";
	steps = { set: { gwta: "set {name} to {value}", action: async () => OK }, testStep: { gwta: "test step with {param}", action: async () => OK } };
}

/** A connection that records what the server sends and the handlers it registers. */
function fakeConnection(open: TextDocument[] = []) {
	const sent: { uri: string; diagnostics: Diagnostic[] }[] = [];
	const statuses: Parameters<TLspConnection["sendWorkspaceInfo"]>[0][] = [];
	const registered: TLspHandlers[] = [];
	const connection: TLspConnection = {
		listen: (handlers) => void registered.push(handlers),
		sendDiagnostics: (uri, diagnostics) => void sent.push({ uri, diagnostics }),
		sendWorkspaceInfo: (info) => void statuses.push(info),
		document: (uri) => open.find((document) => document.uri === uri),
		documents: () => open,
	};
	return { connection, sent, statuses, registered };
}

/** Workspaces where every document is outside one. */
const outsideAWorkspace: TWorkspaces = { find: () => undefined, backgrounds: () => Promise.resolve([]), countFeatures: () => Promise.resolve(0) };

const quietLog = (): TLspLog => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** An activities stepper whose steps are its base steps, set in a world, as a run sets it. */
async function activities(): Promise<ActivitiesStepper> {
	const stepper = new ActivitiesStepper();
	await stepper.setWorld(getDefaultWorld(), [stepper]);
	return stepper;
}

/** The heads of the waypoints whose rules apply. */
const heads = (stepper: ActivitiesStepper) => stepper.steps.apply.rules().map(({ head }) => head);

function serverOver(steppers: AStepper[], options: { open?: TextDocument[]; workspaces?: TWorkspaces; backgrounds?: TFeature[]; log?: TLspLog; world?: TWorld } = {}) {
	const fake = fakeConnection(options.open);
	const later: (() => void)[] = [];
	const log = options.log ?? quietLog();
	const server = new LanguageServer({
		ports: { connection: fake.connection, workspaces: options.workspaces ?? outsideAWorkspace, clock: { later: (task) => void later.push(task) } },
		world: options.world ?? getDefaultWorld(),
		steppers,
		backgrounds: options.backgrounds ?? [],
		log,
	});
	server.listen();
	return { server, later, log, ...fake };
}

const featureDocument = (path: string, text: string) => TextDocument.create(`file://${path}`, "haibun", 1, text);

describe("the language server's diagnostics", () => {
	it("sends an error across a line that doesn't resolve", async () => {
		const { server, sent } = serverOver([new SampleStepper()]);
		await server.processDocument(featureDocument("/tmp/diag.feature", "invalid step"));
		expect(sent).toMatchObject([
			{ uri: "file:///tmp/diag.feature", diagnostics: [{ severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: "invalid step".length } } }] },
		]);
	});

	it("sends an error across the Backgrounds: line where a background it names isn't found", async () => {
		const { server, sent } = serverOver([new Haibun()]);
		await server.processDocument(featureDocument("/tmp/test-missing-bg.feature", "Scenario: Test\n    Backgrounds: nonexistent/path\n    pause for 1s"));
		const warning = sent[0]?.diagnostics.find((diagnostic) => diagnostic.message.startsWith("Background not found"));
		expect(warning).toMatchObject({ severity: 1, range: { start: { line: 1, character: 0 }, end: { line: 1, character: "    Backgrounds: nonexistent/path".length } } });
	});

	it("sends an error for a kireji string that doesn't resolve to one step, and holds the steps that resolve", async () => {
		const path = "/tmp/sample.feature.ts";
		const text = 'const steps: TKirejiStep = ["set x to 1", "not a step"];';
		const { server, sent } = serverOver([new SampleStepper()]);
		await server.processDocument(TextDocument.create(`file://${path}`, "typescript", 1, text));
		expect(sent[0]?.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["'not a step' doesn't resolve to one step."]);
		expect(server.placedSteps(path)).toMatchObject([{ startOffset: text.indexOf("set x to 1"), length: "set x to 1".length }]);
	});
});

describe("the language server's documents", () => {
	it("holds the steps a document resolves, which its semantic tokens paint", async () => {
		const path = "/tmp/tokens.feature";
		const document = featureDocument(path, 'set foo to "bar"\nA line of prose.');
		const { server } = serverOver([new SampleStepper()], { open: [document] });
		await server.processDocument(document);
		expect(server.placedSteps(path)).toHaveLength(1);
		expect(server.semanticTokens(document.uri).map(({ line, type }) => [line, type])).toEqual([
			[0, "function"],
			[0, "parameter"],
			[0, "function"],
			[0, "parameter"],
			[0, "function"],
			[1, "comment"],
		]);
	});

	it("registers a background's waypoints again from its current text, and validates the other open documents later", async () => {
		const stepper = await activities();
		const other = featureDocument("/tmp/features/other.feature", "waypoint Bar");
		const { server, later, sent } = serverOver([stepper], { open: [other] });
		const path = "/tmp/backgrounds/test.bg.feature";
		await server.processDocument(featureDocument(path, "Activity: MyActivity\nwaypoint Foo"));
		expect(heads(stepper)).toContain("Foo");
		await server.processDocument(featureDocument(path, "Activity: MyActivity\nwaypoint Bar"));
		expect(heads(stepper)).toEqual(["Bar"]);
		const sentBefore = sent.length;
		for (const task of later) task();
		await vi.waitFor(() => expect(sent.slice(sentBefore).map(({ uri }) => uri)).toContain(other.uri));
	});
});

describe("the language server's completion", () => {
	it("completes the waypoint heads that the document, its backgrounds and the saved waypoints state, from the rules the resolver reads", async () => {
		const world = getDefaultWorld();
		const stepper = new ActivitiesStepper();
		const steppers = [stepper, new SampleStepper()];
		await stepper.setWorld(world, steppers);
		registerDomains(world, [[savedWaypointDomainDefinition]]);
		registerStepperNames(world, steppers.map(constructorName));
		world.runtime.steppers = steppers;
		openRunRegistry(world, steppers);
		await stepper.saveWaypoint("Knocked twice", ['set knocks to "2"'], "a saved waypoint");
		const document = featureDocument("/tmp/features/dinner.feature", "Activity: Cook\nwaypoint {m:meal} is ready with set meal to m");
		const { server, registered } = serverOver(steppers, { open: [document], world });
		await server.processDocument(featureDocument("/tmp/backgrounds/table.feature", "Activity: Lay\nwaypoint Table is laid"));
		await server.processDocument(document);
		const labels = registered[0]?.completion({ textDocument: { uri: document.uri }, position: { line: 0, character: 0 } }).map(({ label }) => label);
		expect(labels).toEqual(expect.arrayContaining(["Knocked twice", "Table is laid", "{m:meal} is ready", "set {name} to {value}"]));
		expect(labels).not.toContain("apply");
		const elsewhere = registered[0]?.completion({ textDocument: { uri: "file:///tmp/features/other.feature" }, position: { line: 0, character: 0 } }).map(({ label }) => label);
		expect(elsewhere).not.toContain("{m:meal} is ready");
	});
});

describe("the language server's hover", () => {
	it("hovers over a kireji line that applies a waypoint with the waypoint's head", async () => {
		const stepper = await activities();
		const path = "/tmp/features/hover.feature.ts";
		const document = TextDocument.create(`file://${path}`, "typescript", 1, 'const steps: TKirejiStep = ["The table is laid"];');
		const { server, registered } = serverOver([stepper], { open: [document] });
		await server.processDocument(featureDocument("/tmp/backgrounds/table.feature", "Activity: Lay\nwaypoint The table is laid"));
		await server.processDocument(document);
		const hover = registered[0]?.hover({ textDocument: { uri: document.uri }, position: { line: 0, character: 30 } });
		expect(hover?.contents).toMatchObject({ value: expect.stringContaining("`table is laid`") });
	});

	it("hovers over a feature's line that applies a waypoint with the waypoint's head, and paints that line as the call", async () => {
		const stepper = await activities();
		const document = featureDocument("/tmp/features/dinner.feature", "Activity: Cook\nwaypoint dinner is ready\n\ndinner is ready");
		const { server, registered } = serverOver([stepper], { open: [document] });
		await server.processDocument(document);
		const hover = registered[0]?.hover({ textDocument: { uri: document.uri }, position: { line: 3, character: 0 } });
		expect(hover?.contents).toMatchObject({ value: expect.stringContaining("`dinner is ready`") });
		expect(server.semanticTokens(document.uri).filter(({ line }) => line === 3)).toEqual([{ line: 3, char: 0, length: "dinner is ready".length, type: "function" }]);
	});
});

describe("the language server's workspace status", () => {
	const workspace: TWorkspace = { base: "/w", configPath: "/w/config.json", backgroundsPath: "/w/backgrounds" };

	it("counts a workspace's features once per document and reads its backgrounds once", async () => {
		const workspaces = { find: vi.fn(() => workspace), backgrounds: vi.fn(() => Promise.resolve([])), countFeatures: vi.fn(() => Promise.resolve(3)) };
		const { server, statuses } = serverOver([new SampleStepper()], { workspaces });
		await server.processDocument(featureDocument("/w/features/a.feature", "set a to 1"));
		await server.processDocument(featureDocument("/w/features/b.feature", "set b to 2"));
		expect(workspaces.countFeatures).toHaveBeenCalledTimes(2);
		expect(workspaces.backgrounds).toHaveBeenCalledTimes(1);
		expect(statuses).toEqual([
			{ base: "/w", config: "/w/config.json", backgroundCount: 0, featureCount: 3, stepperCount: 1, mcpTools: [] },
			{ base: "/w", config: "/w/config.json", backgroundCount: 0, featureCount: 3, stepperCount: 1, mcpTools: [] },
		]);
	});

	it("leaves out a feature count it can't read, and logs why through the world's logger", async () => {
		const workspaces: TWorkspaces = { find: () => workspace, backgrounds: () => Promise.resolve([]), countFeatures: () => Promise.reject(new Error("unreadable")) };
		const { server, statuses, log } = serverOver([new SampleStepper()], { workspaces });
		await server.processDocument(featureDocument("/w/features/a.feature", "set a to 1"));
		expect(statuses[0]).not.toHaveProperty("featureCount");
		expect(log.error).toHaveBeenCalledWith(expect.stringContaining("unreadable"));
	});

	it("reports a document outside a workspace with the server's backgrounds", async () => {
		const { server, statuses } = serverOver([new SampleStepper()]);
		await server.processDocument(featureDocument("/tmp/loose.feature", "set a to 1"));
		expect(statuses).toEqual([{ base: OUTSIDE_A_WORKSPACE, config: null, backgroundCount: 0, stepperCount: 1, mcpTools: [] }]);
	});
});

describe("the language server's tool handler", () => {
	class McpStepper extends AStepper {
		description = "Lists and runs one tool, for the tool handler to reach.";
		steps = {};
		getTools = () => [{ name: "echo" }];
		executeTool = (name: string, args: Record<string, unknown>) => Promise.resolve({ name, args });
	}

	it("is registered once, however many workspace statuses the server sends", async () => {
		const { server, registered, statuses } = serverOver([new McpStepper(), new SampleStepper()]);
		await server.processDocument(featureDocument("/tmp/a.feature", "set a to 1"));
		await server.processDocument(featureDocument("/tmp/b.feature", "set b to 2"));
		expect(statuses).toHaveLength(2);
		expect(registered).toHaveLength(1);
		await expect(registered[0]?.executeTool({ name: "echo", arguments: { said: "hi" } })).resolves.toEqual({ name: "echo", args: { said: "hi" } });
		expect(statuses[0]?.mcpTools).toEqual([{ name: "echo" }]);
	});

	it("refuses a call where actuality doesn't hold a stepper that runs tools", async () => {
		const { registered } = serverOver([new SampleStepper()]);
		await expect(registered[0]?.executeTool({ name: "echo", arguments: {} })).rejects.toThrow("doesn't hold an McpStepper");
	});
});

describe("the language server's output", () => {
	let stdout: MockInstance;
	beforeEach(() => {
		stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	});
	afterEach(() => stdout.mockRestore());

	it("writes to the world's logger and never to standard output, which carries the protocol's messages", async () => {
		const stepper = await activities();
		const document = featureDocument("/test/feature.feature", 'set foo to "bar"\ninvalid step that errors');
		const { server, log } = serverOver([stepper, new SampleStepper()], { open: [document] });
		await server.processDocument(document);
		await server.processDocument(featureDocument("/test/backgrounds/broken.feature", "Backgrounds: missing"));
		server.semanticTokens(document.uri);
		expect(stdout).not.toHaveBeenCalled();
		expect(log.error).toHaveBeenCalledWith(expect.stringContaining("broken.feature"));
	});
});

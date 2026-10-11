/**
 * MonitorStepper: Buffers execution events and forwards them via SSE transport.
 * Works with any config that has @haibun/web-server-hono (shared transport).
 * The shu frontend receives events via SSE for live updates and fetches history via RPC.
 * At endFeature, writes a standalone HTML file with embedded events, quads, and concerns.
 */
import { resolve } from "node:path";
import { z } from "zod";

import { AStepper, type IHasCycles, type IHasOptions, type TStepperSteps, StepperKinds, CycleWhen, type TEndFeature, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import { recordBlip } from "@haibun/core/lib/record-blip.js";
// The view vocabulary declares itself at import, so an arriving batch finds its names already declared here.
import "./domains/blips.js";
import "./graph-blips.js";
import { type TWorld } from "@haibun/core/lib/world.js";
import { OK, type THaibunEvent } from "@haibun/core/schema/protocol.js";
import { actionOKWithProducts, stringOrError, intOrError, findStepper, findStepperFromOptionOrKind, getStepperOption, errorDetail } from "@haibun/core/lib/util/index.js";
import { localOrigin } from "@haibun/core/lib/local-origin.js";
import { actualURI } from "@haibun/core/lib/util/node/actualURI.js";
import { fromJsonText } from "@haibun/core/lib/json-text.js";
import { TRANSPORT, type ITransport } from "@haibun/web-server-hono/sse-transport.js";
import type WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import { WEBSERVER, type IWebServer, type MiddlewareHandler } from "@haibun/web-server-hono/defs.js";
import { AStorage } from "@haibun/domain-storage/AStorage.js";
import { Access } from "@haibun/core/lib/resources.js";
import { CLIENT_RING, SHU_TAG } from "./domains/elements.js";
import { ARTIFACT_POLICY } from "./domains/serving.js";
import { MONITOR_OPENS_AT, reportHtml } from "./pipelines/monitor-report.js";
import { recordProduced, recordSaid } from "./pipelines/run-records.js";
import { reportWriter, servedBundles } from "./root.js";
import { READS_THE_RUNS_ARTIFACTS } from "@haibun/core/lib/actions.js";
import { requiring } from "@haibun/web-server-hono/capability-auth.js";
import { logMessageDomainDefinition } from "@haibun/core/lib/log-message.js";
import { ARTIFACTS_ROUTE, runArtifactDomainDefinition } from "@haibun/core/lib/run-artifact.js";
import type ShuStepper from "./shu-stepper.js";
import { DOMAIN_GRAPH_QUERY } from "@haibun/core/lib/quad-types.js";
import { DOMAIN_FILE_PATH } from "@haibun/core/lib/domains.js";

// The monitor holds a window of what actuality sends, never actuality itself: an unbounded buffer exhausts the process's
// heap over months. The store holds the graph and the disk log holds the events.

const DOMAIN_LOG_EVENT = "shu-log-event";

/** Serves a response under the artifact policy, which the response is given as it leaves. */
const sandboxed: MiddlewareHandler = async (c, next) => {
	await next();
	c.res.headers.set("Content-Security-Policy", ARTIFACT_POLICY);
};

/** Where the monitor serves the shu views of actuality on its own port. */
export const MONITOR_PATH = "/monitor";

/**
 * The type a graph query named, read off the step that ran it. The match is the argument's DOMAIN, not the step's name:
 * a deployment answers graph queries with its own step, and every one of them takes an argument of this domain, so this
 * reads the type from whichever step answered. Undefined for every other event.
 */
function queriedLabelOf(event: THaibunEvent): string | undefined {
	const values = (event as { stepValuesMap?: Record<string, { domain?: string; value?: unknown }> }).stepValuesMap;
	if (values === undefined) return undefined;
	for (const held of Object.values(values)) {
		if (held?.domain !== DOMAIN_GRAPH_QUERY) continue;
		const label = (held.value as { label?: unknown } | undefined)?.label;
		if (typeof label === "string" && label) return label;
	}
	return undefined;
}

/** Client-side log event forwarded from the SPA. Validated with Zod at the action boundary. */
const LogEventSchema = z.object({
	level: z.enum(["debug", "trace", "info", "warn", "error"]),
	message: z.string().min(1),
	source: z.string().optional(),
	attributes: z.record(z.string(), z.unknown()).optional(),
});
export type TLogEvent = z.infer<typeof LogEventSchema>;

const DOMAIN_CLIENT_BLIPS = "shu-client-blips";
/** The domain of a standalone shu report a step wrote: where it was written. */
const DOMAIN_SHU_REPORT = "shu-report";

/** A batch of fine-grained occurrences the SPA recorded and handed over together, since one request each is not
 *  sustainable at the rate they happen. `recorded` is everything the page has recorded, so a batch a full buffer
 *  truncated reports so rather than reading as the whole. */
const ClientBlipsSchema = z.object({
	blips: z.array(z.object({ name: z.string(), value: z.number().optional(), attributes: z.record(z.string(), z.unknown()).optional(), at: z.number() })).max(CLIENT_RING),
	recorded: z.number().optional(),
});
type TClientBlips = z.infer<typeof ClientBlipsSchema>;

export default class MonitorStepper extends AStepper implements IHasCycles, IHasOptions {
	description = "Records what a run logs and produces, and serves the shu views what it holds";
	/** The type a reader is looking at: the last one a graph query named, so a record of this run opens where the run
	 *  left off. Per feature, like everything else a report carries. */
	private queriedLabel: string | undefined = undefined;
	/** Occurrences accepted from the SPA, so a page whose buffer overflowed between batches can be told apart from a quiet one. */
	private clientBlipsReceived = 0;
	private storage!: AStorage;
	private outputPath?: string;
	// A record write ends before the stepper that owns the store closes it, so what a feature logged is written while the
	// store still accepts writes.
	cyclesWhen = { startFeature: CycleWhen.LAST, endFeature: CycleWhen.LAST - 1 };

	options = {
		[StepperKinds.STORAGE]: { desc: "Storage for standalone HTML output", parse: stringOrError },
		PORT: {
			desc: `The port the monitor serves the shu views of actuality on, at ${MONITOR_PATH}, apart from any server a feature starts. Unset, the monitor doesn't serve them`,
			// A port is one process's: a process that starts another doesn't hand the child its monitor's port.
			perProcess: true,
			parse: intOrError,
		},
	};

	private steppers: AStepper[] = [];
	/** The event stream of the monitor's own server, which lasts the whole of actuality, where a feature's lasts the feature. */
	private monitorTransport?: ITransport;

	private get transport(): ITransport | undefined {
		return this.getWorld().runtime[TRANSPORT] as ITransport | undefined;
	}

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
		this.storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
	}

	/** Serve the shu views of actuality on the monitor's own port, on a server of the instance's that lasts the whole of
	 *  actuality: the app and what the steps captured. */
	private async serveMonitor(port: number): Promise<void> {
		const webServer = findStepper<WebServerStepper>(this.steppers, "WebServerStepper");
		const shu = findStepper<ShuStepper>(this.steppers, "ShuStepper");
		this.monitorTransport = await webServer.serveForExecution("monitor", port, (server) => {
			shu.serveApp(server, MONITOR_PATH, MONITOR_OPENS_AT);
			this.serveArtifacts(server);
		});
		const origin = webServer.hostname ? `http://${webServer.hostname}:${port}` : localOrigin(port);
		this.getWorld().eventLogger.info(`the monitor shows actuality at ${origin}${MONITOR_PATH}`);
	}

	/** What actuality's steps captured, served on a server. A capture shows what the steps saw, so only a caller holding a
	 *  private read is served one, and each is served sandboxed, so one opened by its address runs no script here. */
	private serveArtifacts(webserver: IWebServer): void {
		const artifactDir = resolve(this.storage.getArtifactBasePath());
		this.storage.ensureDirExists(artifactDir);
		const privately = requiring(READS_THE_RUNS_ARTIFACTS, this.getWorld().runtime, webserver);
		webserver.addKnownStaticFolder(artifactDir, ARTIFACTS_ROUTE, { description: "What actuality's steps captured, such as screenshots and videos" }, privately, sandboxed);
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: [DOMAIN_LOG_EVENT], schema: fromJsonText(LogEventSchema), description: "Client-side log event forwarded from the SPA" },
				{ selectors: [DOMAIN_CLIENT_BLIPS], schema: fromJsonText(ClientBlipsSchema), description: "A batch of fine-grained occurrences recorded in the SPA" },
				{ selectors: [DOMAIN_SHU_REPORT], schema: z.object({ path: z.string() }), description: "Where a standalone shu report was written" },
				// This stepper writes records of these two types: what actuality logged and what it produced.
				logMessageDomainDefinition,
				runArtifactDomainDefinition,
			],
		}),
		startExecution: async () => {
			const port = getStepperOption(this, "PORT", this.getWorld().moduleOptions);
			if (port) await this.serveMonitor(Number(port));
		},
		startFeature: () => {
			this.serveArtifacts(this.getWorld().runtime[WEBSERVER] as IWebServer);
		},
		onEvent: (event: THaibunEvent) => {
			const queried = queriedLabelOf(event);
			if (queried !== undefined) this.queriedLabel = queried;
			// A quad announced is a quad the store holds, so the graph a view reads is read from the store rather than
			// held again here. The live page still receives the announcement over the stream.
			if (event.kind === "log") this.beganWriting(recordSaid(this.getWorld(), event, this.saidCount++), "what actuality logged");
			if (event.kind === "artifact") this.beganWriting(recordProduced(this.getWorld(), event, this.producedCount++), "what actuality produced");
			this.transport?.send({ type: "event", event });
			this.monitorTransport?.send({ type: "event", event });
		},
		endFeature: async ({ shouldClose }: TEndFeature) => {
			// An explicit `saves shu to <path>` step is honored regardless of HAIBUN_STAY (shouldClose=false).
			const hasFixedPath = !!this.outputPath;
			const writesReport = hasFixedPath || (shouldClose && !!this.storage);
			if (writesReport) await this.writeStandaloneReport({ fixedPath: this.outputPath, compressed: true });
			// The stepper that owns the store closes it as the feature ends, so a record write begun during the feature
			// finishes here, while the store still accepts writes.
			await this.written();
			if (!writesReport) return;
			// Each feature's report stands alone: the per-feature buffers are cleared so the next feature's report holds
			// only its own, and serialized artifacts resolve from the report's own directory. The stream is unaffected.
			this.saidCount = 0;
			this.producedCount = 0;
			this.queriedLabel = undefined;
		},
	};

	/**
	 * Build the standalone HTML report from the live event/quad buffers and write it.
	 * Callable any time during a feature so a feature can capture a snapshot at a
	 * chosen point, `saves shu to <path>` triggers a write, and `endFeature` writes
	 * once more so the final state always reflects the full run.
	 */
	/**
	 * What a run logged, written as a record under the step it was logged during. A reader is told it by the run logging it,
	 * over the stream; this is the durable copy of that same statement, which is what a reader asks for when they were
	 * not there to hear it. The type declares that writing it is not announced, so logging it once is logging it once.
	 */
	/** How many statements have been recorded, so two logged in one millisecond are two records rather than one written
	 *  over the other. A record's identity cannot rest on a clock a run can outpace. */
	private saidCount = 0;
	/** The same, for what a run produced. */
	private producedCount = 0;

	/** Every record write begun and not finished, as one chain. Recording is started from an event handler, which
	 *  returns before the store has the record, so the chain is what a feature waits on to end with its records
	 *  written. Each write settles the chain, and a failed write adds its error to `unrecorded`. */
	private writing: Promise<unknown> = Promise.resolve();
	/** The errors of the record writes that failed since the feature began. */
	private unrecorded: unknown[] = [];

	/** Adds `write` to the chain. A failed write is reported once on the console, which doesn't write a record, so the
	 *  report doesn't start another record write. */
	private beganWriting(write: Promise<unknown>, what: string): void {
		const settled = write.then(
			() => undefined,
			(err: unknown) => {
				console.error(`[monitor] ${what} wasn't recorded: ${errorDetail(err)}`);
				this.unrecorded.push(err);
			},
		);
		this.writing = this.writing.then(() => settled);
	}

	/** Waits for every record write begun so far, including one begun by writing the report, and throws where a write
	 *  failed. The next feature starts a new chain. */
	private async written(): Promise<void> {
		const writes = this.writing;
		this.writing = Promise.resolve();
		await writes;
		const [first, ...more] = this.unrecorded.splice(0);
		if (first !== undefined)
			throw new Error(`[monitor] ${more.length + 1} records of what actuality logged or produced weren't written. The first write failed: ${errorDetail(first)}`, { cause: first });
	}

	/** Writes the standalone report of actuality at `fixedPath`, or as an artifact of the feature where a path isn't
	 *  given, and returns where it was written. */
	private async writeStandaloneReport({ fixedPath, compressed }: { fixedPath?: string; compressed: boolean }): Promise<string> {
		const viewSteps = Object.entries(this.steps)
			.filter(([, step]) => !step.gwta.includes("{"))
			.map(([name, step]): [string, () => unknown] => [name, step.action as () => unknown]);
		const world = this.getWorld();
		const html = await reportHtml({ world, viewSteps, queriedLabel: this.queriedLabel, reportBundle: servedBundles.report(), compressed });
		const written = fixedPath === undefined ? (await this.storage.saveArtifact("shu.html", html)).absolutePath : fixedPath;
		if (fixedPath !== undefined) reportWriter.write(fixedPath, html);
		world.eventLogger.info(`shu standalone report: ${actualURI(written)}`);
		return written;
	}

	steps = {
		savesShuTo: {
			gwta: `saves shu to {where: ${DOMAIN_FILE_PATH}}`,
			description:
				"Write the standalone shu HTML report to the given path. Invokable any time during a feature; endFeature writes once more so the final file always reflects the full run.",
			productsDomain: DOMAIN_SHU_REPORT,
			action: async ({ where }: { where: string }) => {
				this.outputPath = where;
				const written = await this.writeStandaloneReport({ fixedPath: where, compressed: true });
				return actionOKWithProducts({ path: written });
			},
		},
		savesShuUncompressedTo: {
			gwta: `saves shu uncompressed to {where: ${DOMAIN_FILE_PATH}}`,
			description:
				"Write the standalone shu report with an uncompressed plain-JSON payload, so the redacted text can be read and audited directly, same content as the compressed report, just larger. A one-off write that does not become the feature's canonical output.",
			productsDomain: DOMAIN_SHU_REPORT,
			action: async ({ where }: { where: string }) => {
				const written = await this.writeStandaloneReport({ fixedPath: where, compressed: false });
				return actionOKWithProducts({ path: written });
			},
		},
		// Singleton view openers. Hypermedia markers (`_type` + `_component` + `id` + `view`
		// + `_summary`) are injected by the dispatcher from each domain's `ui.component`,
		// so every view-opening step shares the same single mechanism.
		showMonitor: { gwta: "show monitor", productsDomain: SHU_TAG.MONITOR_COLUMN, action: () => actionOKWithProducts({}) },
		showDocument: { gwta: "show document", productsDomain: SHU_TAG.DOCUMENT_COLUMN, action: () => actionOKWithProducts({}) },
		logClient: {
			gwta: `log client {event: ${DOMAIN_LOG_EVENT}}`,
			action: ({ event }: { event: TLogEvent }) => {
				const { level, message, source, attributes } = event;
				const prefix = source ? `[${source}] ` : "";
				const line = `${prefix}${message}`;
				if (level === "warn") this.getWorld().eventLogger.warn(line, attributes);
				else if (level === "error") this.getWorld().eventLogger.error(line, attributes);
				else if (level === "debug") this.getWorld().eventLogger.debug(line, attributes);
				else this.getWorld().eventLogger.info(line, attributes);
				return OK;
			},
		},
		recordClientBlips: {
			gwta: `record client blips {batch: ${DOMAIN_CLIENT_BLIPS}}`,
			description:
				"Receive a batch of fine-grained occurrences the SPA recorded and put each into actuality's blip channel, in the order the browser recorded them. A read: actuality doesn't retain a blip, so it doesn't record a batch's arrival either. A recorded batch would be a step whose events reach the page and repaint a scene that then records what it drew.",
			read: true,
			// A blip reaches actuality's telemetry, so a caller holds the read of what actuality records, as its own page does.
			readsAt: Access.private,
			action: ({ batch }: { batch: TClientBlips }) => {
				const world = this.getWorld();
				for (const blip of batch.blips) recordBlip(world, blip.name, blip.value, { ...blip.attributes, at: blip.at });
				// A browser buffer that overflowed between batches would otherwise be invisible: actuality holds what it was
				// given, and the page holds the truth about what it saw.
				this.clientBlipsReceived += batch.blips.length;
				// A page that doesn't count what it recorded states only the batch it sent.
				const missed = batch.recorded === undefined ? 0 : batch.recorded - this.clientBlipsReceived;
				if (missed > 0) world.eventLogger.debug(`[shu] ${missed} client occurrence(s) recorded but not delivered; the page's buffer filled between batches`);
				return OK;
			},
		},
	} as const satisfies TStepperSteps;
}

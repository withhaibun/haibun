/**
 * MonitorStepper — Buffers execution events and forwards them via SSE transport.
 * Works with any config that has @haibun/web-server-hono (shared transport).
 * The shu frontend receives events via SSE for live updates and fetches history via RPC.
 * At endFeature, writes a standalone HTML file with embedded events, quads, and concerns.
 */
import { resolve } from "path";
import { z } from "zod";
import { writeFileSync } from "fs";

import { AStepper, type IHasCycles, type IHasOptions, type TStepperSteps, StepperKinds, CycleWhen, type TEndFeature, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import { recordBlip } from "@haibun/core/lib/blips.js";
// The view vocabulary declares itself at import, so an arriving batch finds its names already declared here.
import "./view-blips.js";
import "./graph-blips.js";
import { type TWorld } from "@haibun/core/lib/world.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";

import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { OBSCURED_VALUE } from "@haibun/core/lib/feature-variables.js";
import { actionOKWithProducts, stringOrError, findStepperFromOptionOrKind, errorDetail } from "@haibun/core/lib/util/index.js";
import { actualURI } from "@haibun/core/lib/util/node/actualURI.js";
import { objectCoercer } from "@haibun/core/lib/domains.js";
import { TRANSPORT, type ITransport } from "@haibun/web-server-hono/sse-transport.js";
import { WEBSERVER, type IWebServer } from "@haibun/web-server-hono/defs.js";
import { AStorage } from "@haibun/domain-storage/AStorage.js";
import { EMediaTypes } from "@haibun/domain-storage/media-types.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import type { TTag } from "@haibun/core/lib/ttag.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { SEQ_PATH_FIELD, executionOf, extractSeqPathPrefix, formatRecordName, parseSeqPath } from "@haibun/core/lib/seq-path.js";
import { SHU_TAG } from "./consts.js";
import { LOG_MESSAGE_EDGE, LOG_MESSAGE_FIELD, LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { RUN_ARTIFACT_EDGE, RUN_ARTIFACT_FIELD, RUN_ARTIFACT_LABEL } from "@haibun/core/lib/run-artifact.js";
import { loadReportBundle, buildReportHtml, buildGraphSource } from "./shu-stepper.js";

import { DISCOVERY_RESPONSE } from "@haibun/web-server-hono/web-server-stepper.js";

import { DOMAIN_GRAPH_QUERY } from "@haibun/core/lib/quad-types.js";
import { CACHE_SHAPE, type TCachePayload } from "./client-cache/index.js";

// The in-memory buffers hold a recent WINDOW, never the run: over months, an unbounded buffer is the process's heap
// death (a first-time index of a large mailbox OOMed the daemon at ~4GB). The store is canonical for graph data and
// the disk log for event history; these buffers only serve live backfill and the live cluster extension.

/**
 * Component JS to inline in the offline report: a domain's `ui.jsContent`, but only for components whose view is in the
 * final report (the columns shown at endFeature). A heavy external-component bundle is embedded only when its view is
 * actually shown, and never paid for otherwise. Pure + exported so the inclusion rule is unit-tested.
 */
export function inlineScriptsForView(domains: Record<string, unknown>, finalViewComponents: Set<string>): string[] {
	return Object.values(domains)
		.map((d) => (d as { ui?: { component?: string; jsContent?: string } } | undefined)?.ui)
		.filter(
			(u): u is { component: string; jsContent: string } =>
				typeof u?.jsContent === "string" && u.jsContent.length > 0 && typeof u.component === "string" && finalViewComponents.has(u.component),
		)
		.map((u) => u.jsContent);
}

export const DOMAIN_LOG_EVENT = "shu-log-event";

/**
 * The type a graph query named, read off the step that ran it. The match is the argument's DOMAIN, not the step's name:
 * a deployment answers graph queries with its own step, and every one of them takes an argument of this domain, so this
 * reads the type from whichever step answered. Undefined for every other event.
 */
export function queriedLabelOf(event: THaibunEvent): string | undefined {
	const values = (event as { stepValuesMap?: Record<string, { domain?: string; value?: unknown }> }).stepValuesMap ?? {};
	for (const held of Object.values(values)) {
		if (held?.domain !== DOMAIN_GRAPH_QUERY) continue;
		const label = (held.value as { label?: unknown } | undefined)?.label;
		if (typeof label === "string" && label) return label;
	}
	return undefined;
}

/** Client-side log event forwarded from the SPA. Validated with Zod at the action boundary. */
export const LogEventSchema = z.object({
	level: z.enum(["debug", "trace", "info", "warn", "error"]).default("info"),
	message: z.string().min(1),
	source: z.string().optional(),
	attributes: z.record(z.string(), z.unknown()).optional(),
});
export type TLogEvent = z.infer<typeof LogEventSchema>;

export const DOMAIN_CLIENT_BLIPS = "shu-client-blips";

/** A batch of fine-grained occurrences the SPA recorded and handed over together, since one request each is not
 *  affordable at the rate they happen. `recorded` is everything the page has recorded, so a batch a full buffer
 *  truncated says so rather than reading as the whole. */
export const ClientBlipsSchema = z.object({
	blips: z.array(z.object({ name: z.string(), value: z.number().optional(), attributes: z.record(z.string(), z.unknown()).optional(), at: z.number() })),
	recorded: z.number().optional(),
});
export type TClientBlips = z.infer<typeof ClientBlipsSchema>;

/** The step an event happened in, as the path the run walks: what a run says or produces names itself for that step,
 *  and what is named for no step has none. */
const stepOf = (e: Record<string, unknown>): number[] => {
	const path = extractSeqPathPrefix(String(e.id));
	return path === null ? [] : (parseSeqPath(path) ?? []);
};

/** The step a record belongs to, named as any record is named; empty where it belongs to no step. */
const underStep = (tag: TTag, e: Record<string, unknown>): string => {
	const path = stepOf(e);
	return path.length ? formatRecordName({ execution: executionOf(tag), path }) : "";
};

/** A record's own name: the execution it belongs to, the step it came from, and which of that step's it is. */
const recordId = (tag: TTag, e: Record<string, unknown>, ordinal: number): string => formatRecordName({ execution: executionOf(tag), path: stepOf(e), ordinal });

export default class MonitorStepper extends AStepper implements IHasCycles, IHasOptions {
	description = "Records what a run says and produces, and serves the shu views what it holds";
	/** The type a reader is looking at: the last one a graph query named, so a record of this run opens where the run
	 *  left off. Per feature, like everything else a report carries. */
	private queriedLabel = "";
	/** Occurrences accepted from the SPA, so a page whose buffer overflowed between batches can be told apart from a quiet one. */
	private clientBlipsReceived = 0;
	private storage!: AStorage;
	private outputPath?: string;
	// A record write ends before the stepper that owns the store closes it, so what a feature said is written while the
	// store still accepts writes.
	cyclesWhen = { startFeature: CycleWhen.LAST, endFeature: CycleWhen.LAST - 1 };

	options = {
		[StepperKinds.STORAGE]: { desc: "Storage for standalone HTML output", parse: stringOrError },
	};

	private get transport(): ITransport | undefined {
		return this.getWorld().runtime[TRANSPORT] as ITransport | undefined;
	}

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		this.storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: [DOMAIN_LOG_EVENT],
					schema: LogEventSchema,
					coerce: objectCoercer(LogEventSchema),
					description: "Client-side log event forwarded from the SPA",
				},
				{
					selectors: [DOMAIN_CLIENT_BLIPS],
					schema: ClientBlipsSchema,
					coerce: objectCoercer(ClientBlipsSchema),
					description: "A batch of fine-grained occurrences recorded in the SPA",
				},
			],
		}),
		startFeature: () => {
			const webserver = this.getWorld().runtime[WEBSERVER] as IWebServer;
			const artifactDir = resolve(this.storage.getArtifactBasePath());
			this.storage.ensureDirExists(artifactDir);
			webserver.addKnownStaticFolder(artifactDir, "/artifacts");
		},
		onEvent: (event: THaibunEvent) => {
			const e = event as Record<string, unknown>;
			this.queriedLabel = queriedLabelOf(event) ?? this.queriedLabel;
			// A quad announced is a quad the store holds, so the graph a view reads is read from the store rather than
			// held again here. The live page still receives the announcement over the stream.
			if (e.kind === "log") this.beganWriting(this.recordSaid(event));
			if (e.kind === "artifact") this.beganWriting(this.recordProduced(event));
			this.transport?.send({ type: "event", event });
		},
		endFeature: async ({ shouldClose = true }: TEndFeature) => {
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
			this.queriedLabel = "";
		},
	};

	/**
	 * Build the standalone HTML report from the live event/quad buffers and write it.
	 * Callable any time during a feature so a feature can capture a snapshot at a
	 * chosen point — `saves shu to <path>` triggers a write, and `endFeature` writes
	 * once more so the final state always reflects the full run.
	 */
	/**
	 * What a run said, written as a record under the step it was said during. A reader is told it by the run saying it,
	 * over the stream; this is the durable copy of that same statement, which is what a reader asks for when they were
	 * not there to hear it. The type declares that writing it is not announced, so saying it once is saying it once.
	 */
	/** How many statements have been recorded, so two said in one millisecond are two records rather than one written
	 *  over the other. A record's identity cannot rest on a clock a run can outpace. */
	private saidCount = 0;
	/** The same, for what a run produced. */
	private producedCount = 0;

	/** Every record write begun and not finished, as one chain. Recording is started from an event handler, which
	 *  returns before the store has the record, so the chain is what a feature waits on to end with its records
	 *  written. A write reports its own failure and settles, so the chain never rejects. */
	private writing: Promise<unknown> = Promise.resolve();

	private beganWriting(write: Promise<unknown>): void {
		this.writing = this.writing.then(() => write);
	}

	/** Wait for every record write begun so far, including one begun by writing the report. The next feature starts a
	 *  new chain, so a write that failed is reported once. */
	private async written(): Promise<void> {
		const writes = this.writing;
		this.writing = Promise.resolve();
		await writes;
	}

	private async recordSaid(event: THaibunEvent): Promise<void> {
		const e = event as Record<string, unknown>;
		const message = typeof e.message === "string" ? e.message : undefined;
		if (message === undefined) return;
		const at = typeof e.timestamp === "number" ? e.timestamp : Date.now();
		const said = underStep(this.getWorld().tag, e);
		const record: Record<string, unknown> = {
			[LOG_MESSAGE_FIELD.id]: recordId(this.getWorld().tag, e, this.saidCount++),
			[LOG_MESSAGE_FIELD.execution]: executionOf(this.getWorld().tag),
			[LOG_MESSAGE_FIELD.recordedAtTime]: new Date().toISOString(),
			[LOG_MESSAGE_FIELD.message]: message,
			[LOG_MESSAGE_FIELD.level]: e.level,
			[LOG_MESSAGE_FIELD.generatedAtTime]: new Date(at).toISOString(),
			...(said ? { [LOG_MESSAGE_EDGE.isPartOf]: said } : {}),
		};
		await this.getWorld()
			.shared.getStore()
			.upsertIndividual(LOG_MESSAGE_LABEL, record)
			.catch((err) => this.getWorld().eventLogger.warn(`[monitor] what the run said was not recorded: ${errorDetail(err)}`));
	}

	/**
	 * What a run produced, written as a record under the step that produced it. The record says where the artifact is
	 * and what it is, not what it holds: an artifact is a file, and a record of it is a pointer to that file.
	 *
	 * A trace of the run's own machinery says where nothing is, because it is not a file the run produced. The graph
	 * holds such a trace as what it is instead: a request is an HttpRequest, and a record of it here would be a second
	 * copy of the same fact.
	 */
	private async recordProduced(event: THaibunEvent): Promise<void> {
		const e = event as Record<string, unknown>;
		if (typeof e.path !== "string") return;
		const at = typeof e.timestamp === "number" ? e.timestamp : Date.now();
		const under = underStep(this.getWorld().tag, e);
		const record: Record<string, unknown> = {
			[RUN_ARTIFACT_FIELD.id]: recordId(this.getWorld().tag, e, this.producedCount++),
			[RUN_ARTIFACT_FIELD.execution]: executionOf(this.getWorld().tag),
			[RUN_ARTIFACT_FIELD.recordedAtTime]: new Date().toISOString(),
			[RUN_ARTIFACT_FIELD.artifactType]: String(e.artifactType ?? "file"),
			[RUN_ARTIFACT_FIELD.path]: e.path,
			...(typeof e.featureRelativePath === "string" ? { [RUN_ARTIFACT_FIELD.featureRelativePath]: e.featureRelativePath } : {}),
			...(typeof e.mimetype === "string" ? { [RUN_ARTIFACT_FIELD.mediaType]: e.mimetype } : {}),
			[RUN_ARTIFACT_FIELD.generatedAtTime]: new Date(at).toISOString(),
			[RUN_ARTIFACT_FIELD.level]: e.level ?? "info",
			...(under ? { [RUN_ARTIFACT_EDGE.isPartOf]: under } : {}),
		};
		await this.getWorld()
			.shared.getStore()
			.upsertIndividual(RUN_ARTIFACT_LABEL, record)
			.catch((err) => this.getWorld().eventLogger.warn(`[monitor] what the run produced was not recorded: ${errorDetail(err)}`));
	}

	/** The run as the page holds it, for a page with no site to read it from: the graph the run wrote, which is the run,
	 *  and the site's registry as it stood. */
	private cacheForReport(registry: unknown, quads: TQuad[]): TCachePayload {
		return { shape: CACHE_SHAPE, execution: executionOf(this.getWorld().tag), registry, quads };
	}

	private async writeStandaloneReport({ fixedPath, compressed }: { fixedPath?: string; compressed: boolean }): Promise<string> {
		// A report carries the run and the view state it was left in, never the answers a live page happened to receive:
		// the run rides in the client cache (its events, the graph as quads, the site's declarations), and every read a
		// view makes of those is answered from what the page holds. What is left is what a view SHOWED and the run does
		// not say, which is produced here.
		const viewProducts: Record<string, unknown> = {};
		// The view toggles: parameterless steps with a `.view` product, run once so the page opens where the reader left it.
		const candidates = Object.entries(this.steps).filter(([, step]) => !step.gwta.includes("{"));
		const logger = this.getWorld().eventLogger;
		await Promise.all(
			candidates.map(async ([name, step]) => {
				try {
					const r = (await (step.action as () => unknown)()) as { products?: Record<string, unknown> } | undefined;
					const products = r?.products;
					if (products?.view) viewProducts[`MonitorStepper-${name}`] = products;
				} catch (err) {
					logger.warn(`[shu writeStandaloneReport] step ${name} failed: ${errorDetail(err)}`);
				}
			}),
		);
		// The site's declarations ride in the cache as the registry, where a page with no server reads them, so there is
		// one place a registry comes from: what this server served a page, as that page was allowed to see it.
		const registry = this.getWorld().runtime[DISCOVERY_RESPONSE] ?? { steps: [], domains: {}, concerns: buildConcernCatalog(this.getWorld().domains) };
		// 3. End-of-run snapshots for the affordances panel. Earlier RPC calls cached
		// the early empty-graph state; the panel's offline render uses the cache, so the
		// last live snapshot is the one that matters. Re-run the read the panel makes
		// to overwrite with end-of-run forward / goals / waypoints, under the name it asks by.
		const steppers = (this.getWorld().runtime.steppers as AStepper[] | undefined) ?? [];
		for (const stepper of steppers) {
			const refreshable = ["affordancesOnOffer"];
			for (const name of refreshable) {
				const step = stepper.steps?.[name];
				if (!step || typeof (step as { action?: unknown }).action !== "function") continue;
				const key = `${stepper.constructor.name}-${name}`;
				try {
					const r = (await (step as { action: (a: Record<string, unknown>) => unknown }).action({})) as { products?: Record<string, unknown> } | undefined;
					if (r?.products) viewProducts[key] = r.products;
				} catch (err) {
					logger.warn(`[shu writeStandaloneReport] ${key} refresh failed: ${errorDetail(err)}`);
				}
			}
		}
		// The whole graph, as the site holds it: it rides in the cache as quads, and a page reading it clusters them for
		// itself, so what a reader sees of the graph is what the views would have painted from the site's own answer.
		const built = await buildGraphSource(this.getWorld());
		if (!built) logger.warn("[shu writeStandaloneReport] the graph was not captured: this store does not cluster, so a page reading this report has no graph");
		// The address a report opens at names the type the query column was showing, which no record of the run states.
		// Which views were open it does not name: the page reads those from the records it carries, by the same read a
		// page with a server makes. What is inlined is the code those views need, so the views are still read for that.
		const shown = await this.getWorld().shared.getStore().query({ predicate: SEQ_PATH_FIELD.showed, namedGraph: SEQ_PATH_LABEL });
		const domains = this.getWorld().domains;
		const cols = new Set(shown.map((quad) => String((domains[String(quad.object ?? "")]?.ui as { component?: string } | undefined)?.component ?? quad.object ?? "")));
		const viewHash = this.queriedLabel ? `#?label=${encodeURIComponent(this.queriedLabel)}` : "";
		const hydration = JSON.stringify({ viewProducts, viewHash, cache: this.cacheForReport(registry, built?.quads ?? []) });
		const scripts = inlineScriptsForView(this.getWorld().domains, new Set(cols));
		let payload = JSON.stringify({ bundle: loadReportBundle(), hydration, scripts });
		const secrets = await this.getWorld().shared.getSecrets();
		for (const [, value] of Object.entries(secrets)) if (value) payload = payload.replaceAll(value, OBSCURED_VALUE);
		const html = buildReportHtml(".", payload, compressed);
		if (fixedPath) {
			writeFileSync(fixedPath, html);
			logger.info(`shu standalone report: ${actualURI(fixedPath)}`);
			return fixedPath;
		}
		const saved = await this.storage.saveArtifact("shu.html", html, EMediaTypes.html);
		logger.info(`shu standalone report: ${actualURI(saved.absolutePath)}`);
		return saved.absolutePath;
	}

	steps = {
		savesShuTo: {
			gwta: "saves shu to {where: string}",
			description:
				"Write the standalone shu HTML report to the given path. Invokable any time during a feature; endFeature writes once more so the final file always reflects the full run.",
			action: async ({ where }: { where: string }) => {
				this.outputPath = where;
				const written = await this.writeStandaloneReport({ fixedPath: where, compressed: true });
				return actionOKWithProducts({ path: written });
			},
		},
		savesShuUncompressedTo: {
			gwta: "saves shu uncompressed to {where: string}",
			description:
				"Write the standalone shu report with an uncompressed plain-JSON payload, so the redacted text can be read and audited directly — same content as the compressed report, just larger. A one-off write that does not become the feature's canonical output.",
			action: async ({ where }: { where: string }) => {
				const written = await this.writeStandaloneReport({ fixedPath: where, compressed: false });
				return actionOKWithProducts({ path: written });
			},
		},
		// Singleton view openers. Hypermedia markers (`_type` + `_component` + `id` + `view`
		// + `_summary`) are injected by the dispatcher from each domain's `ui.component`,
		// so every view-opening step shares the same single mechanism.
		showMonitor: {
			gwta: "show monitor",
			productsDomain: SHU_TAG.MONITOR_COLUMN,
			action: () => actionOKWithProducts({}),
		},
		showDocument: {
			gwta: "show document",
			productsDomain: SHU_TAG.DOCUMENT_COLUMN,
			action: () => actionOKWithProducts({}),
		},
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
				return actionOKWithProducts({});
			},
		},
		recordClientBlips: {
			gwta: `record client blips {batch: ${DOMAIN_CLIENT_BLIPS}}`,
			description: "Receive a batch of fine-grained occurrences the SPA recorded and put each into the run's blip channel, in the order the browser recorded them.",
			action: ({ batch }: { batch: TClientBlips }) => {
				const world = this.getWorld();
				for (const blip of batch.blips) recordBlip(world, blip.name, blip.value, { ...blip.attributes, at: blip.at });
				// A browser buffer that overflowed between batches would otherwise be invisible: the run holds what it was
				// given, and the page holds the truth about what it saw.
				const missed = (batch.recorded ?? 0) - (this.clientBlipsReceived += batch.blips.length);
				if (missed > 0) world.eventLogger.debug(`[shu] ${missed} client occurrence(s) recorded but not delivered; the page's buffer filled between batches`);
				return actionOKWithProducts({});
			},
		},
	} satisfies TStepperSteps;
}

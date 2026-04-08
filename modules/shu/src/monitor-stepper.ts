/**
 * MonitorStepper — Buffers execution events and forwards them via SSE transport.
 * Works with any config that has @haibun/web-server-hono (shared transport).
 * The shu frontend receives events via SSE for live updates and fetches history via RPC.
 */
import { z } from "zod";
import { AStepper, type IHasCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import { actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import type { IStepperCycles } from "@haibun/core/lib/defs.js";
import { TRANSPORT, type ITransport } from "@haibun/web-server-hono/sse-transport.js";
import { parseSeqPath } from "./quad-detail-pane.js";

const MAX_EVENTS = 10000;

export default class MonitorStepper extends AStepper implements IHasCycles {
	description = "Buffers execution events for the shu monitor view";
	private events: THaibunEvent[] = [];

	private get transport(): ITransport | undefined {
		return this.getWorld().runtime[TRANSPORT] as ITransport | undefined;
	}

	cycles: IStepperCycles = {
		onEvent: (event: THaibunEvent) => {
			this.events.push(event);
			if (this.events.length > MAX_EVENTS) this.events.shift();
			this.transport?.send({ type: "event", event });
		},
	};

	steps = {
		showMonitor: {
			gwta: "show monitor",
			action: () => actionOKWithProducts({ view: "monitor" }),
		},
		showSequenceDiagram: {
			gwta: "show sequence diagram",
			action: () => actionOKWithProducts({ view: "sequence" }),
		},
		getEvents: {
			gwta: "get monitor events",
			outputSchema: z.object({ events: z.array(z.unknown()) }),
			action: ({ level, kind, since }: { level?: string; kind?: string; since?: number }) => {
				let filtered: THaibunEvent[] = this.events;
				if (level) filtered = filtered.filter((e) => e.level === level);
				if (kind) filtered = filtered.filter((e) => e.kind === kind);
				if (since) filtered = filtered.filter((e) => e.timestamp >= since);
				return actionOKWithProducts({
					events: filtered.map(({ kind, level, timestamp, id, ...rest }) => ({
						kind, level, timestamp, id,
						in: (rest as Record<string, unknown>).in,
						message: (rest as Record<string, unknown>).message,
						type: (rest as Record<string, unknown>).type,
						stage: (rest as Record<string, unknown>).stage,
						status: (rest as Record<string, unknown>).status,
						actionName: (rest as Record<string, unknown>).actionName,
						artifactType: (rest as Record<string, unknown>).artifactType,
						seqPath: parseSeqPath(id),
					})),
				});
			},
		},
		getDispatchTraces: {
			gwta: "get dispatch traces",
			outputSchema: z.object({ traces: z.array(z.unknown()) }),
			action: () => {
				const traces = this.events
					.filter((e) => e.kind === "artifact" && (e as Record<string, unknown>).artifactType === "dispatch-trace")
					.map((e) => {
						const t = (e as Record<string, unknown>).trace;
						return typeof t === "object" && t ? { ...(t as Record<string, unknown>) } : t;
					});
				return actionOKWithProducts({ traces });
			},
		},
		showGraphView: {
			gwta: "show graph view",
			action: () => actionOKWithProducts({ view: "graph" }),
		},
		getQuads: {
			gwta: "get quads",
			outputSchema: z.object({ quads: z.array(z.unknown()) }),
			action: async () => {
				const store = this.getWorld().shared.getStore();
				const quads = await store.all();
				return actionOKWithProducts({
					quads: quads.map(({ subject, predicate, object, namedGraph, timestamp, properties }) => ({ subject, predicate, object, namedGraph, timestamp, properties })),
				});
			},
		},
	} satisfies TStepperSteps;
}

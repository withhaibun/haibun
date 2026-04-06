/**
 * MonitorStepper — Buffers execution events in memory and serves them via RPC.
 * Lightweight replacement for monitor-browser-stepper within the shu SPA.
 * The shu frontend fetches historical events on connect, then subscribes to SSE for live updates.
 */
import { z } from "zod";
import { AStepper, type IHasCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import { actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import type { IStepperCycles } from "@haibun/core/lib/defs.js";

const MAX_EVENTS = 10000;

export default class MonitorStepper extends AStepper implements IHasCycles {
	description = "Buffers execution events for the shu monitor view";
	private events: THaibunEvent[] = [];

	cycles: IStepperCycles = {
		onEvent: (event: THaibunEvent) => {
			this.events.push(event);
			if (this.events.length > MAX_EVENTS) this.events.shift();
		},
	};

	steps = {
		showMonitor: {
			gwta: "show monitor",
			action: () => {
				return actionOKWithProducts({ view: "monitor" });
			},
		},
		showSequenceDiagram: {
			gwta: "show sequence diagram",
			action: () => {
				return actionOKWithProducts({ view: "sequence" });
			},
		},
		getEvents: {
			gwta: "get monitor events",
			outputSchema: z.object({ events: z.array(z.unknown()) }),
			action: ({ level, kind, since }: { level?: string; kind?: string; since?: number }) => {
				let filtered: THaibunEvent[] = this.events;
				if (level) filtered = filtered.filter((e) => e.level === level);
				if (kind) filtered = filtered.filter((e) => e.kind === kind);
				if (since) filtered = filtered.filter((e) => e.timestamp >= since);
				// Shallow-copy events to break circular references (products → events → products)
				return actionOKWithProducts({
					events: filtered.map(({ kind, level, timestamp, id, ...rest }) => ({
						kind,
						level,
						timestamp,
						id,
						in: (rest as Record<string, unknown>).in,
						message: (rest as Record<string, unknown>).message,
						type: (rest as Record<string, unknown>).type,
						stage: (rest as Record<string, unknown>).stage,
						status: (rest as Record<string, unknown>).status,
						actionName: (rest as Record<string, unknown>).actionName,
						artifactType: (rest as Record<string, unknown>).artifactType,
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
	} satisfies TStepperSteps;
}

/**
 * OpenTelemetry Monitor Stepper for Haibun
 *
 * Exports Haibun events as OpenTelemetry traces and logs to OTLP-compatible backends.
 * Reads events as core's THaibunEvent and derives step status with core's EventFormatter.
 */

import { AStepper, IHasCycles, IHasOptions, StepperKinds, IStepperCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { NameSchema } from "@haibun/core/lib/domains/domains.js";
import { OK, SPECULATIVE_FAILURE, STATUS, type TBlipEvent } from "@haibun/core/lib/domains/protocol.js";
import { THaibunEvent, EventFormatter } from "@haibun/core/lib/domains/protocol.js";
import { stringOrError, getStepperOption } from "@haibun/core/lib/util/index.js";
import { LEVEL_STATUS, actualityMachine, isActualityMove, runningFeature, type TActualityMove } from "@haibun/core/lib/actuality/machines/actuality.js";

import { trace, Tracer, Span, SpanStatusCode, context } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import type { TOtelProviders } from "./ports.js";
import { otelProviders } from "./root.js";

/** The name of a custom span for the startSpan and endSpan steps. */
const DOMAIN_SPAN_NAME = "otel-span-name";

export default class MonitorOtelStepper extends AStepper implements IHasCycles, IHasOptions {
	description = "Exports actuality's features, steps and artifacts as OpenTelemetry spans and its logs as log records. startSpan and endSpan start and end custom spans.";
	kind = StepperKinds.MONITOR;

	private tracerProvider: TOtelProviders["tracerProvider"] | undefined;
	private loggerProvider: TOtelProviders["loggerProvider"] | undefined;
	private tracer: Tracer | undefined;
	private featureSpan: Span | undefined;
	private stepSpans: Map<string, Span> = new Map();
	private detachBlips: (() => void) | undefined;
	/** The execution's levels, moved by the lifecycle events this stepper receives: a feature's span starts where the
	 *  machine starts the feature, and ends where the machine ends it. */
	private readonly actuality = actualityMachine();

	options = {
		OTEL_ENDPOINT: { desc: "OpenTelemetry OTLP endpoint (default: http://localhost:4318)", parse: stringOrError },
		SERVICE_NAME: { desc: "Service name for traces and logs (default: haibun)", parse: stringOrError },
	};

	private initializeIfNeeded() {
		if (this.tracerProvider) return;

		const world = this.getWorld();
		const endpoint = getStepperOption(this, "OTEL_ENDPOINT", world.moduleOptions) || "http://localhost:4318";
		const serviceName = getStepperOption(this, "SERVICE_NAME", world.moduleOptions) || "haibun";

		this.initializeOtel(endpoint, serviceName);
	}

	private initializeOtel(endpoint: string, serviceName: string) {
		({ tracerProvider: this.tracerProvider, loggerProvider: this.loggerProvider } = otelProviders(endpoint, serviceName));
		this.tracer = trace.getTracer("haibun-monitor-otel", "1.0.0");
		this.getWorld().eventLogger.info(`[monitor-otel] Initialized with endpoint: ${endpoint}, service: ${serviceName}`);
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({ domains: [{ selectors: [DOMAIN_SPAN_NAME], schema: NameSchema, description: "The name of a custom span for the startSpan and endSpan steps" }] }),
		startExecution: async () => {
			await Promise.resolve();
			this.initializeIfNeeded();
			// Actuality doesn't retain a blip. recordBlip adds each blip as a span event on its step span. A trace backend can
			// then query the blips in order and by step. Only a subscription that lists the blip kind receives blips. The
			// onEvent cycle doesn't receive blips.
			if (!this.detachBlips) {
				const { eventLogger } = this.getWorld();
				const onBlip = (event: THaibunEvent) => event.kind === "blip" && this.recordBlip(event);
				eventLogger.subscribe(onBlip, { kinds: ["blip"] });
				this.detachBlips = () => eventLogger.unsubscribe(onBlip);
			}
		},
		// Exports feature, step and artifact events as spans and log events as log records. The Executor delivers each event
		// through this cycle once.
		onEvent: async (event: THaibunEvent) => {
			await Promise.resolve();
			this.processEvent(event);
		},
		endExecution: async () => {
			await Promise.resolve();
			this.detachBlips?.();
			this.detachBlips = undefined;
			await this.shutdown();
		},
	};

	/** Moves the machine with a level's event, and starts or ends the feature's span where the move starts or ends a feature. */
	private moveFeature(tracer: Tracer | undefined, move: TActualityMove): void {
		const before = runningFeature(this.actuality.state.get());
		const after = runningFeature(this.actuality.dispatch(move));
		if (before !== undefined && after?.id !== before.id && this.featureSpan) {
			const ended = this.actuality.state.get().features.find((feature) => feature.id === before.id);
			if (ended?.status === LEVEL_STATUS.failed) this.featureSpan.setStatus({ code: SpanStatusCode.ERROR, message: `${before.id} failed` });
			this.featureSpan.end();
			this.featureSpan = undefined;
			this.stepSpans.clear();
		}
		// The feature span is the root span of the feature's spans.
		if (tracer !== undefined && after !== undefined && after.id !== before?.id)
			this.featureSpan = tracer.startSpan(`feature: ${after.path ?? after.id}`, { attributes: { "haibun.event.type": "feature", "haibun.event.id": after.id } });
	}

	private processEvent(event: THaibunEvent) {
		const tracer = this.tracer;
		// The machine takes every move, so it holds the levels whether or not the tracer has started.
		if (event.kind === "lifecycle" && isActualityMove(event)) this.moveFeature(tracer, event);
		if (!tracer) return;

		const logger = logs.getLogger("haibun-monitor-otel");

		if (event.kind === "lifecycle") {
			if (event.type === "step") {
				if (event.stage === "start") {
					// Starts a feature span when this stepper didn't receive a feature start event.
					if (!this.featureSpan) {
						this.featureSpan = tracer.startSpan("feature: haibun-execution", { attributes: { "haibun.event.type": "feature", "haibun.auto.created": true } });
					}

					// Each step span is a child of the feature span.
					const parentContext = this.featureSpan ? trace.setSpan(context.active(), this.featureSpan) : context.active();

					const stepSpan = tracer.startSpan(
						`step: ${event.in || event.id}`,
						{
							attributes: {
								"haibun.event.type": "step",
								"haibun.event.id": event.id,
								"haibun.stepper": event.stepperName || "unknown",
								"haibun.action": event.actionName || "unknown",
								"haibun.intent.mode": event.intent?.mode || "authoritative",
							},
						},
						parentContext,
					);

					this.stepSpans.set(event.id, stepSpan);
				} else if (event.stage === "end") {
					const stepSpan = this.stepSpans.get(event.id);
					if (stepSpan) {
						// getIndication separates a speculative failure from a failure.
						const indication = EventFormatter.getIndication(event);
						if (indication === STATUS.failed) {
							stepSpan.setStatus({ code: SpanStatusCode.ERROR, message: event.error });
							stepSpan.setAttribute("haibun.error", event.error || "unknown error");
						} else if (indication === SPECULATIVE_FAILURE) {
							stepSpan.setAttribute("haibun.speculative.failed", true);
							stepSpan.setAttribute("haibun.error", event.error || "speculative failure");
						}
						stepSpan.end();
						this.stepSpans.delete(event.id);
					}
				}
			}
		} else if (event.kind === "log") {
			const severityMap: Record<string, SeverityNumber> = {
				debug: SeverityNumber.DEBUG,
				trace: SeverityNumber.TRACE,
				info: SeverityNumber.INFO,
				warn: SeverityNumber.WARN,
				error: SeverityNumber.ERROR,
			};

			// Copies event.attributes unchanged into the log record attributes. Emitters write OTel-aligned keys: haibun.* for
			// haibun data and exception.* for error data.
			logger.emit({
				severityNumber: severityMap[event.level] || SeverityNumber.INFO,
				severityText: event.level.toUpperCase(),
				body: event.message,
				attributes: { "haibun.event.id": event.id, "haibun.event.kind": "log", ...event.attributes },
			});
		} else if (event.kind === "artifact") {
			// The artifact span's parent is its step span or the feature span.
			const parentSpan = this.getParentSpanForId(event.id) || this.featureSpan;
			const parentContext = parentSpan ? trace.setSpan(context.active(), parentSpan) : context.active();

			const artifactPath = "path" in event ? event.path : undefined;
			const artifactMimetype = "mimetype" in event ? event.mimetype : undefined;
			const artifactSpan = tracer.startSpan(
				`artifact: ${event.artifactType}`,
				{
					attributes: {
						"haibun.event.type": "artifact",
						"haibun.event.id": event.id,
						"haibun.artifact.type": event.artifactType,
						...(artifactMimetype && { "haibun.artifact.mimetype": artifactMimetype }),
						...(artifactPath && { "haibun.artifact.path": artifactPath }),
					},
				},
				parentContext,
			);

			// An artifact is a point-in-time event. Its span ends immediately.
			artifactSpan.end();
		}
	}

	/** Adds a blip as a span event on the open step span for its seqPath or the nearest open ancestor step span. The blip's
	 *  seqPath is the trace context. The site that emits a blip doesn't pass a span. recordBlip adds the event to the
	 *  feature span when the blip doesn't carry a seqPath or a matching step span isn't open. It drops the blip when the
	 *  feature span isn't open either. */
	private recordBlip(blip: TBlipEvent): void {
		const span = (blip.seqPath ? this.getParentSpanForId(`${blip.seqPath}.`) : undefined) ?? this.featureSpan;
		if (!span) return;
		span.addEvent(
			blip.name,
			{ ...(blip.value !== undefined ? { "haibun.blip.value": blip.value } : {}), ...((blip.attributes ?? {}) as Record<string, string | number | boolean>) },
			blip.timestamp,
		);
	}

	private getParentSpanForId(id: string): Span | undefined {
		// Drops the trailing dotted segments of id one at a time and returns the first open step span that matches.
		// For the artifact id "1.2.3.artifact", it returns the span of step "1.2.3".
		const parts = id.split(".");
		for (let i = parts.length - 1; i >= 0; i--) {
			const possibleStepId = parts.slice(0, i).join(".");
			const stepSpan = this.stepSpans.get(possibleStepId);
			if (stepSpan) return stepSpan;
		}
		return undefined;
	}

	private async shutdown() {
		// forceFlush exports pending spans and log records before each provider shuts down.
		if (this.tracerProvider) {
			try {
				await this.tracerProvider.forceFlush();
			} catch (e) {
				console.error("[monitor-otel] Flushing traces failed. Check the OTEL_ENDPOINT option:", e);
			}
			await this.tracerProvider.shutdown();
			this.tracerProvider = undefined;
		}
		if (this.loggerProvider) {
			try {
				await this.loggerProvider.forceFlush();
			} catch (e) {
				console.error("[monitor-otel] Flushing logs failed. Check the OTEL_ENDPOINT option:", e);
			}
			await this.loggerProvider.shutdown();
			this.loggerProvider = undefined;
		}
		this.getWorld().eventLogger.info("[monitor-otel] Shutdown complete");
	}

	steps = {
		// A named custom span is a child of the feature span. startSpan doesn't start one when the feature span isn't open.
		startSpan: {
			gwta: `start otel span {name: ${DOMAIN_SPAN_NAME}}`,
			action: async ({ name }: { name: string }) => {
				await Promise.resolve();
				if (this.tracer && this.featureSpan) {
					const parentContext = trace.setSpan(context.active(), this.featureSpan);
					const span = this.tracer.startSpan(`custom: ${name}`, {}, parentContext);
					this.stepSpans.set(`custom-${name}`, span);
				}
				return OK;
			},
		},
		endSpan: {
			gwta: `end otel span {name: ${DOMAIN_SPAN_NAME}}`,
			action: async ({ name }: { name: string }) => {
				await Promise.resolve();
				const span = this.stepSpans.get(`custom-${name}`);
				if (span) {
					span.end();
					this.stepSpans.delete(`custom-${name}`);
				}
				return OK;
			},
		},
	} as const satisfies TStepperSteps;
}

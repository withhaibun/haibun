/**
 * OpenTelemetry Monitor Stepper for Haibun
 * 
 * Exports Haibun events as OpenTelemetry traces and logs to OTLP-compatible backends.
 * Uses core monitor utilities (EventFormatter, THaibunEvent) for consistency.
 */

import { AStepper, IHasCycles, IHasOptions, StepperKinds } from '@haibun/core/lib/astepper.js';
import { IStepperCycles, TWorld, OK } from '@haibun/core/lib/defs.js';
import { THaibunEvent, EventFormatter } from '@haibun/core/monitor/index.js';
import { stringOrError, getStepperOption } from '@haibun/core/lib/util/index.js';

import { trace, Tracer, Span, SpanStatusCode, context } from '@opentelemetry/api';
import { NodeTracerProvider, BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

export default class MonitorOtelStepper extends AStepper implements IHasCycles, IHasOptions {
  kind = StepperKinds.MONITOR;

  private tracerProvider: NodeTracerProvider | undefined;
  private loggerProvider: LoggerProvider | undefined;
  private tracer: Tracer | undefined;
  private featureSpan: Span | undefined;
  private stepSpans: Map<string, Span> = new Map();

  options = {
    OTEL_ENDPOINT: {
      desc: 'OpenTelemetry OTLP endpoint (default: http://localhost:4318)',
      parse: stringOrError
    },
    SERVICE_NAME: {
      desc: 'Service name for traces (default: haibun)',
      parse: stringOrError
    }
  };

  async setWorld(world: TWorld, steppers: AStepper[]) {
    super.setWorld(world, steppers);

    // Subscribe to events using same pattern as monitor-browser
    world.eventLogger.setStepperCallback((event: THaibunEvent) => {
      this.onEvent(event);
    });
  }

  private initializeIfNeeded() {
    if (this.tracerProvider) return; // Already initialized

    const world = this.getWorld();
    const endpoint = getStepperOption(this, 'OTEL_ENDPOINT', world.moduleOptions) || 'http://localhost:4318';
    const serviceName = getStepperOption(this, 'SERVICE_NAME', world.moduleOptions) || 'haibun';

    this.initializeOtel(endpoint, serviceName);
  }

  private initializeOtel(endpoint: string, serviceName: string) {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: '1.0.0',
    });

    // Trace provider - use SimpleSpanProcessor for immediate export
    const traceExporter = new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    });
    this.tracerProvider = new NodeTracerProvider({
      resource,
      spanProcessors: [new SimpleSpanProcessor(traceExporter)]
    });
    this.tracerProvider.register();
    this.tracer = trace.getTracer('haibun-monitor-otel', '1.0.0');

    // Log provider
    const logExporter = new OTLPLogExporter({
      url: `${endpoint}/v1/logs`,
    });
    const logProcessor = new BatchLogRecordProcessor(logExporter);
    // Type assertion needed due to SDK types not matching runtime API
    this.loggerProvider = new LoggerProvider({ resource, logRecordProcessor: logProcessor } as any);
    logs.setGlobalLoggerProvider(this.loggerProvider);

    this.getWorld().logger.info(`[monitor-otel] Initialized with endpoint: ${endpoint}, service: ${serviceName}`);
  }

  cycles: IStepperCycles = {
    startExecution: async () => {
      // Initialize OTel provider at start of execution
      this.initializeIfNeeded();
    },
    onEvent: async (event: THaibunEvent) => {
      this.processEvent(event);
    },
    endFeature: async () => {
      // End feature span
      if (this.featureSpan) {
        this.featureSpan.end();
        this.featureSpan = undefined;
      }
      // Clear step spans
      this.stepSpans.clear();
    },
    endExecution: async () => {
      // Flush and shutdown
      await this.shutdown();
    }
  };

  private onEvent(event: THaibunEvent) {
    this.processEvent(event);
  }

  private processEvent(event: THaibunEvent) {
    if (!this.tracer) return;

    const logger = logs.getLogger('haibun-monitor-otel');

    if (event.kind === 'lifecycle') {
      if (event.type === 'feature' && event.stage === 'start') {
        // Start root span for feature
        this.featureSpan = this.tracer.startSpan(`feature: ${event.label || 'unknown'}`, {
          attributes: {
            'haibun.event.type': 'feature',
            'haibun.event.id': event.id,
          }
        });
      } else if (event.type === 'step') {
        if (event.stage === 'start') {
          // Create feature span if not yet created (for when feature events aren't forwarded)
          if (!this.featureSpan) {
            this.featureSpan = this.tracer.startSpan('feature: haibun-execution', {
              attributes: {
                'haibun.event.type': 'feature',
                'haibun.auto.created': true,
              }
            });
          }

          // Start step span as child of feature
          const parentContext = this.featureSpan
            ? trace.setSpan(context.active(), this.featureSpan)
            : context.active();

          const stepSpan = this.tracer.startSpan(`step: ${event.label || event.id}`, {
            attributes: {
              'haibun.event.type': 'step',
              'haibun.event.id': event.id,
              'haibun.stepper': event.stepperName || 'unknown',
              'haibun.action': event.actionName || 'unknown',
              'haibun.intent.mode': event.intent?.mode || 'authoritative',
            }
          }, parentContext);

          this.stepSpans.set(event.id, stepSpan);
        } else if (event.stage === 'end') {
          // End step span
          const stepSpan = this.stepSpans.get(event.id);
          if (stepSpan) {
            // Use EventFormatter for consistent status indication
            const indication = EventFormatter.getIndication(event);
            if (indication === 'failure') {
              stepSpan.setStatus({ code: SpanStatusCode.ERROR, message: event.error });
              stepSpan.setAttribute('haibun.error', event.error || 'unknown error');
            } else if (indication === 'speculative-failure') {
              stepSpan.setAttribute('haibun.speculative.failed', true);
              stepSpan.setAttribute('haibun.error', event.error || 'speculative failure');
            }
            stepSpan.end();
            this.stepSpans.delete(event.id);
          }
        }
      }
    } else if (event.kind === 'log') {
      // Emit as OTel log record
      const severityMap: Record<string, SeverityNumber> = {
        'debug': SeverityNumber.DEBUG,
        'trace': SeverityNumber.TRACE,
        'info': SeverityNumber.INFO,
        'warn': SeverityNumber.WARN,
        'error': SeverityNumber.ERROR,
      };

      logger.emit({
        severityNumber: severityMap[event.level] || SeverityNumber.INFO,
        severityText: event.level.toUpperCase(),
        body: event.message,
        attributes: {
          'haibun.event.id': event.id,
          'haibun.event.kind': 'log',
        }
      });
    } else if (event.kind === 'artifact') {
      // Create artifact span as child of current step span or feature span
      const parentSpan = this.getParentSpanForId(event.id) || this.featureSpan;
      const parentContext = parentSpan
        ? trace.setSpan(context.active(), parentSpan)
        : context.active();

      const artifactPath = 'path' in event ? event.path : undefined;
      const artifactSpan = this.tracer.startSpan(`artifact: ${event.artifactType}`, {
        attributes: {
          'haibun.event.type': 'artifact',
          'haibun.event.id': event.id,
          'haibun.artifact.type': event.artifactType,
          'haibun.artifact.mimetype': event.mimetype,
          ...(artifactPath && { 'haibun.artifact.path': artifactPath }),
        }
      }, parentContext);

      // End immediately - artifacts are point-in-time events
      artifactSpan.end();
    }
  }

  private getParentSpanForId(id: string): Span | undefined {
    // Try to find the parent step span by matching the ID prefix
    // e.g., for artifact ID "1.2.3.artifact", find step "1.2.3"
    const parts = id.split('.');
    for (let i = parts.length - 1; i >= 0; i--) {
      const possibleStepId = parts.slice(0, i).join('.');
      const stepSpan = this.stepSpans.get(possibleStepId);
      if (stepSpan) return stepSpan;
    }
    return undefined;
  }

  private async shutdown() {
    // Force flush to ensure all spans are sent
    if (this.tracerProvider) {
      try {
        await this.tracerProvider.forceFlush();
      } catch (e) {
        console.error('[monitor-otel] Error flushing traces:', e);
      }
      await this.tracerProvider.shutdown();
      this.tracerProvider = undefined;
    }
    if (this.loggerProvider) {
      try {
        await this.loggerProvider.forceFlush();
      } catch (e) {
        console.error('[monitor-otel] Error flushing logs:', e);
      }
      await this.loggerProvider.shutdown();
      this.loggerProvider = undefined;
    }
    this.getWorld().logger.info('[monitor-otel] Shutdown complete');
  }

  steps = {
    // Placeholder step - can be extended for manual span creation
    startSpan: {
      gwta: 'start otel span {name}',
      action: async ({ name }: { name: string }) => {
        if (this.tracer && this.featureSpan) {
          const parentContext = trace.setSpan(context.active(), this.featureSpan);
          const span = this.tracer.startSpan(`custom: ${name}`, {}, parentContext);
          this.stepSpans.set(`custom-${name}`, span);
        }
        return OK;
      }
    },
    endSpan: {
      gwta: 'end otel span {name}',
      action: async ({ name }: { name: string }) => {
        const span = this.stepSpans.get(`custom-${name}`);
        if (span) {
          span.end();
          this.stepSpans.delete(`custom-${name}`);
        }
        return OK;
      }
    }
  };
}

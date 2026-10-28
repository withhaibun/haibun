/**
 * The OTLP exporters of a monitor's spans and log records, at an endpoint and named for a service. A span is exported when
 * it ends, and log records in batches. The tracer provider and the logger provider are registered as the process's own.
 */
import { NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { logs } from "@opentelemetry/api-logs";
import type { TOtelProviders } from "../ports.js";

/** The registered providers that export to `endpoint` as `serviceName`. */
export function otlpProviders(endpoint: string, serviceName: string): TOtelProviders {
	const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName, [ATTR_SERVICE_VERSION]: "1.0.0" });
	const tracerProvider = new NodeTracerProvider({ resource, spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }))] });
	tracerProvider.register();
	const loggerProvider = new LoggerProvider({ resource, processors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs` }) })] });
	logs.setGlobalLoggerProvider(loggerProvider);
	return { tracerProvider, loggerProvider };
}

/** The providers that export a monitor's spans and its log records. */
import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";

export type TOtelProviders = { tracerProvider: NodeTracerProvider; loggerProvider: LoggerProvider };

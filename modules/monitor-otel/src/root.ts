/** The OpenTelemetry monitor's composition root: the OTLP providers of an endpoint. */
import { otlpProviders } from "./adapters/otlp.js";
import type { TOtelProviders } from "./ports.js";

/** The registered providers that export to `endpoint` as `serviceName`. */
export const otelProviders = (endpoint: string, serviceName: string): TOtelProviders => otlpProviders(endpoint, serviceName);

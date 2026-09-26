
import type { StepRegistry } from "@haibun/core/lib/step-registry.js";
import type { IWebServer } from "./defs.js";

/**
 * Pluggable transport abstraction.
 * SSE, MCP, subprocess, and future transports all implement this interface.
 * attach() registers routes/handlers; detach() tears them down on endFeature.
 */
export interface IStepTransport {
	readonly name: string;
	attach(registry: StepRegistry, webserver: IWebServer): void;
	detach(): void;
}

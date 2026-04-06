import { JITSerializer } from "@haibun/core/monitor/index.js";

export interface SerializedState {
	events: unknown[];
	startTime: number | null;
}

// Helper to hydrate on load
export function getInitialState(): SerializedState | null {
	const el = document.getElementById("haibun-data");
	if (el && el.textContent) {
		const text = el.textContent.trim();
		const serializer = new JITSerializer();

		try {
			// JITSerializer format: NDJSON with schema definitions
			const events = serializer.deserialize(text);
			console.log("[Serialize] Loaded events via JIT deserialization:", events.length);
			const firstEvent = events[0] as Record<string, unknown> | undefined;
			const startTime = firstEvent && typeof firstEvent.timestamp === "number" ? firstEvent.timestamp : null;
			return {
				events,
				startTime,
			};
		} catch (e) {
			console.error("Failed to parse embedded data", e);
		}
	}
	return null;
}

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getCachedEntity, setCachedEntity, subscribeEntities, resetEntityStore, type TEntityResult } from "./entity-store.js";
import { setupShuTest, type TShuTestHandle } from "./test-setup.js";
import type { TEvent } from "./event-stream.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const result = (): TEntityResult => ({ vertex: { id: "e1", "@type": "Email", subject: "Hi" }, edges: [], incomingCount: 0 });
const quadEvent = (namedGraph: string, subject: string, predicate: string, object: unknown, objectType?: string): TEvent =>
	({
		id: `${subject}.q`,
		timestamp: 1,
		kind: "artifact",
		artifactType: "json",
		mimetype: "application/json",
		json: { quadObservation: { subject, predicate, object, namedGraph, ...(objectType ? { objectType } : {}), timestamp: 1 } },
	}) as unknown as TEvent;

describe("entity-store", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		resetEntityStore();
		handle = setupShuTest();
	});
	afterEach(() => handle.teardown());

	it("is empty until an entity is cached, then returns it", () => {
		expect(getCachedEntity("Email", "e1")).toBeUndefined();
		setCachedEntity("Email", "e1", result());
		expect(getCachedEntity("Email", "e1")?.vertex.subject).toBe("Hi");
	});

	it("applies a live property change from SSE in place, and notifies — no refetch", async () => {
		setCachedEntity("Email", "e1", result());
		const seen: string[] = [];
		subscribeEntities((s) => seen.push(s));
		handle.emit(quadEvent("Email", "e1", "subject", "Updated"));
		await flush();
		expect(getCachedEntity("Email", "e1")?.vertex.subject).toBe("Updated");
		expect(seen).toContain("e1");
	});

	it("leaves edge quads to a full reopen, not merged as a field", async () => {
		setCachedEntity("Email", "e1", result());
		handle.emit(quadEvent("Email", "e1", "inReplyTo", "e0", "Email"));
		await flush();
		expect(getCachedEntity("Email", "e1")?.vertex.inReplyTo).toBeUndefined();
	});

	it("ignores SSE for an entity not in the copy", async () => {
		setCachedEntity("Email", "e1", result());
		handle.emit(quadEvent("Email", "e2", "subject", "Other"));
		await flush();
		expect(getCachedEntity("Email", "e2")).toBeUndefined();
	});
});

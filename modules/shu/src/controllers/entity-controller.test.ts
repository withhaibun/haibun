// @vitest-environment jsdom
/** The per-view handle to one individual: it relays the store's view to its host on open, on a live change, and on a
 *  re-resolve, and stops relaying for an individual it has released or a host that has disconnected. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LitElement } from "lit";
import { EntityController } from "./entity-controller.js";
import { resetEntityStore, type TEntityView } from "../entity-store.js";
import { setupShuTest, makeEntityDispatch, type TShuTestHandle } from "../test-setup.js";
import type { TEvent } from "../event-stream.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

const quadEvent = (subject: string, predicate: string, object: unknown): TEvent =>
	({
		id: `${subject}.q`,
		timestamp: 1,
		kind: "artifact",
		artifactType: "json",
		mimetype: "application/json",
		json: { quadObservation: { subject, predicate, object, namedGraph: "Email", timestamp: 1 } },
	}) as unknown as TEvent;

class TestHost extends LitElement {
	views: TEntityView[] = [];
	entity = new EntityController(this, (v) => this.views.push(v));
}
if (!customElements.get("test-entity-host")) customElements.define("test-entity-host", TestHost);

describe("EntityController", () => {
	let handle: TShuTestHandle;
	let annotationCalls: number;
	beforeEach(() => {
		resetEntityStore();
		annotationCalls = 0;
		handle = setupShuTest({
			dispatch: makeEntityDispatch({
				entity: () => ({ vertex: { "@id": "e1", subject: "Hi" }, edges: [], incomingCount: 0 }),
				annotations: () => {
					annotationCalls++;
					return { annotations: [] };
				},
			}),
		});
	});
	afterEach(() => handle.teardown());

	const mount = (): TestHost => {
		const el = document.createElement("test-entity-host") as TestHost;
		document.body.appendChild(el);
		return el;
	};

	it("relays the resolved view to its host once the individual has settled", async () => {
		const el = mount();
		await el.entity.open("Email", "e1", "private");
		const last = el.views.at(-1);
		expect(last?.status).toBe("ready");
		expect(last?.entity?.vertex.subject).toBe("Hi");
	});

	it("relays a live change to the individual it holds", async () => {
		const el = mount();
		await el.entity.open("Email", "e1", "private");
		const before = el.views.length;
		handle.emit(quadEvent("e1", "subject", "Updated"));
		await flush();
		expect(el.views.length).toBeGreaterThan(before);
		expect(el.views.at(-1)?.entity?.vertex.subject).toBe("Updated");
	});

	it("ignores a live change for an individual it does not hold", async () => {
		const el = mount();
		await el.entity.open("Email", "e1", "private");
		const before = el.views.length;
		handle.emit(quadEvent("e2", "subject", "Other"));
		await flush();
		expect(el.views.length).toBe(before);
	});

	it("re-resolves the held individual's annotations on request", async () => {
		const el = mount();
		await el.entity.open("Email", "e1", "private");
		const before = annotationCalls;
		el.entity.refreshAnnotations();
		await flush();
		expect(annotationCalls).toBe(before + 1);
	});

	it("takes no further updates for an individual it has released", async () => {
		const el = mount();
		await el.entity.open("Email", "e1", "private");
		el.entity.release();
		const before = el.views.length;
		handle.emit(quadEvent("e1", "subject", "Updated"));
		await flush();
		expect(el.views.length).toBe(before);
	});

	it("stops relaying once its host disconnects", async () => {
		const el = mount();
		await el.entity.open("Email", "e1", "private");
		el.remove();
		const before = el.views.length;
		handle.emit(quadEvent("e1", "subject", "Updated"));
		await flush();
		expect(el.views.length).toBe(before);
	});
});

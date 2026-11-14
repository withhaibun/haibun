import { ACTION_BEGIN } from "../domains/rpc-wire.js";
import { heldRecordIri } from "../../test/declared-types.js";
import { hostHandshake } from "../../test/rpc-answer.js";
import { describe, expect, it } from "vitest";
import { QuadStore, newStoreChain } from "../../steps/pipelines/quad-store.js";
import { equalTo, readUpTo, recordOf } from "../../records/pipelines/record-reads.js";
import { MAX_PAGE_ROWS } from "../../domains/hypermedia.js";
import { storeDeclaring } from "../../test/declared-types.js";
import { handleStoreCall, isStoreMethod } from "../../domains/store-protocol.js";
import { RemoteQuadStore } from "./remote-quad-store.js";
import { FakeInvoker } from "../../test/fake-authority.js";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles } from "../../steps/domains/stepper.js";
import { Access, LinkRelations, openWorld } from "../../domains/resources.js";
import { ASSUMED_CHECK, CHECK_NAMESPACE, field } from "../../steps/domains/contract.js";
import { actionOK } from "../../domains/util.js";
import { passWithDefaults } from "../../test/lib.js";
import { TEST_LEVELS } from "../../test/declared-types.js";
import { TEST_STEP } from "../../test/test-step.js";
import { getSteppers } from "../../adapters/workspace-lib.js";
import { LOGIC_STEPPER } from "../../domains/protocol.js";
import { inCall, runInCall } from "../../domains/capability-context.js";
import { ChangedSinceRead, WRITE_VERB, WriteOutsideContract, type TUnitWrite } from "../../records/domains/unit.js";
import type { TStepWrites } from "../../steps/domains/contract.js";
import { declareSteps } from "../../steps/domains/stepper.js";

const sign = new FakeInvoker("satellite").sign;
const WIDGETS = { Widget: { filters: ["id"] } };
/** A Widget's stored type, whose every record has a name, which the store doesn't require. */
const WIDGET = {
	...openWorld(z.object({ id: z.string(), name: z.string(), colour: z.string().optional() }), ["name"]),
	topology: {
		persistedAs: "Widget",
		accessLevel: Access.private,
		id: "id",
		properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel, colour: LinkRelations.TAG.rel },
	},
};
const WIDGET_ONE = { "@id": heldRecordIri("Widget", "w-1"), "@type": "Widget", id: "w-1", name: "One" };

/** A canned serving instance: a real in-memory QuadStore behind the real protocol handler, plus the handshake. */
function servingPeer(store: QuadStore) {
	const calls: Array<{ method: string; params: Record<string, unknown>; invoked?: string }> = [];
	const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const body = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };
		const headers = init?.headers as Record<string, string>;
		calls.push({ method: body.method, params: body.params, invoked: headers["capability-invocation"]?.match(/action="([^"]+)"/)?.[1] });
		const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
		if (body.method === ACTION_BEGIN) return json(hostHandshake(7, "did:site:main"));
		if (!isStoreMethod(body.method)) return json({ error: `unexpected ${body.method}` }, 422);
		try {
			return json(await handleStoreCall(store, body.method, body.params));
		} catch (err) {
			return json({ error: String(err) }, 422);
		}
	};
	return { calls, fetchImpl: fetchImpl as typeof fetch };
}

describe("RemoteQuadStore", () => {
	it("handshakes the serving site, signs every store call for the action its method takes, and round-trips individuals", async () => {
		const backing = storeDeclaring(WIDGETS);
		const peer = servingPeer(backing);
		const remote = new RemoteQuadStore({ url: "http://main:1", sign, graphs: ["Widget"], fetchImpl: peer.fetchImpl });
		expect(() => remote.site).toThrow(/connect/);
		expect(await remote.connect()).toBe("did:site:main");
		expect(await remote.merge({ "@type": "Widget", id: "w-1", name: "One" })).toBe("w-1");
		expect(await recordOf(remote, "Widget", "w-1")).toEqual(WIDGET_ONE);
		expect(await recordOf(backing, "Widget", "w-1")).toEqual(WIDGET_ONE);
		expect(peer.calls.map((c) => [c.method, c.invoked])).toEqual([
			[ACTION_BEGIN, undefined],
			["store.merge", "store.write"],
			["store.readRecords", "store.read"],
		]);
	});

	it("routes through QuadStore registration: a satellite write lands in the serving store, reads come back", async () => {
		const backing = storeDeclaring(WIDGETS);
		const peer = servingPeer(backing);
		const remote = new RemoteQuadStore({ url: "http://main:1", sign, graphs: ["Widget"], fetchImpl: peer.fetchImpl });
		await remote.connect();
		const satellite = new QuadStore(newStoreChain());
		await satellite.registerStore(remote, ["Widget"]);
		await satellite.merge({ "@type": "Widget", id: "w-9", name: "Nine" });
		const nine = { "@id": heldRecordIri("Widget", "w-9"), "@type": "Widget", id: "w-9", name: "Nine" };
		expect(await recordOf(backing, "Widget", "w-9")).toEqual(nine);
		expect(await readUpTo(satellite, { label: "Widget", filters: equalTo({ id: "w-9" }) }, MAX_PAGE_ROWS)).toEqual([nine]);
	});

	it("stays mount-scoped: all() covers only the mounted graphs and clustered reads intersect the type filter", async () => {
		const backing = new QuadStore(newStoreChain());
		await backing.merge({ "@type": "Widget", "@id": "w-1", name: "One" });
		await backing.merge({ "@type": "Elsewhere", "@id": "p-1", name: "Private" });
		const peer = servingPeer(backing);
		const remote = new RemoteQuadStore({ url: "http://main:1", sign, graphs: ["Widget"], fetchImpl: peer.fetchImpl });
		await remote.connect();
		expect([...new Set((await remote.all()).map((q) => q.namedGraph))]).toEqual(["Widget"]);
		const clustered = await remote.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" });
		expect(clustered.clusters.map((c) => c.type)).toEqual(["Widget"]);
		expect(await remote.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private", types: ["Elsewhere"] })).toEqual({ quads: [], clusters: [] });
	});

	it("surfaces a serving-side refusal as an error, never a silent empty result", async () => {
		const denyingFetch = ((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const body = JSON.parse(String(init?.body)) as { method: string };
			const json = (v: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } }));
			if (body.method === ACTION_BEGIN) return json(hostHandshake(7, "did:site:main"));
			return json({ error: `${body.method}: capability store.write required` }, 422);
		}) as typeof fetch;
		const denied = new RemoteQuadStore({ url: "http://main:1", sign, graphs: ["Widget"], fetchImpl: denyingFetch });
		await denied.connect();
		await expect(denied.merge({ "@type": "Widget", id: "w-1" })).rejects.toThrow(/capability store.write required/);
	});

	it("lists each record a batch writes and each change it refuses within the writes of the step in progress, as a local batch does", async () => {
		const backing = storeDeclaring(WIDGETS, TEST_LEVELS);
		const remote = new RemoteQuadStore({ url: "http://main:1", sign, graphs: ["Widget"], fetchImpl: servingPeer(backing).fetchImpl });
		await remote.connect();
		const writes: TStepWrites = {
			step: "WidgetStepper-colour",
			products: [],
			changes: [{ persistedAs: "Widget", key: "colour" }],
			typeOf: [],
			unitsGiven: false,
			refused: [],
			written: [],
		};
		const units: TUnitWrite[] = [
			{ verb: WRITE_VERB.merge, node: { "@type": "Widget", id: "w-2", colour: "red" } },
			{ verb: WRITE_VERB.merge, node: { "@type": "Widget", id: "w-3", name: "Three" } },
		];
		const ended = await runInCall({ ...inCall(), delegatedWrites: writes }, () => remote.writeMany(units));
		expect(ended[0], "the unit within the contract").toEqual({ id: "w-2" });
		expect(ended[1], "the unit outside the contract").toHaveProperty("refused");
		expect(writes.written, "the step's written records").toEqual([{ label: "Widget", id: "w-2" }]);
		expect(writes.refused, "the step's refused writes").toEqual(["Widget.name"]);
	});

	it("throws a refusal of a unit as the serving store threw it, and adds its change to the step's refused writes", async () => {
		const backing = storeDeclaring(WIDGETS, TEST_LEVELS);
		const remote = new RemoteQuadStore({ url: "http://main:1", sign, graphs: ["Widget"], fetchImpl: servingPeer(backing).fetchImpl });
		await remote.connect();
		const writes: TStepWrites = { step: "WidgetStepper-colour", products: [], changes: [], typeOf: [], unitsGiven: false, refused: [], written: [] };
		await expect(runInCall({ ...inCall(), delegatedWrites: writes }, () => remote.merge({ "@type": "Widget", id: "w-4", name: "Four" }))).rejects.toThrow(WriteOutsideContract);
		expect(writes.refused).toEqual(["Widget.name"]);
		await remote.merge({ "@type": "Widget", id: "w-5", name: "Five" });
		await expect(remote.update({ "@type": "Widget", id: "w-5", name: "Six" }, null)).rejects.toThrow(ChangedSinceRead);
	});

	it("lists each record an assumed step writes through it, and the step's record holds the check of each one", async () => {
		const backing = storeDeclaring(WIDGETS, TEST_LEVELS);
		const remote = new RemoteQuadStore({ url: "http://main:1", sign, graphs: ["Widget"], fetchImpl: servingPeer(backing).fetchImpl });
		/** Reads a widget from outside input and writes it to the store that a serving instance holds. */
		class ReadsWidgets extends AStepper implements IHasCycles {
			description = "Reads a widget from outside input into a Widget record that a serving instance's store holds.";
			cycles: IStepperCycles = {
				getConcerns: () => ({ domains: [{ selectors: ["remote-widget"], ...WIDGET, topology: { ...WIDGET.topology, required: WIDGET.required }, description: "A widget" }] }),
				startActuality: async () => {
					const store = this.getWorld().shared.getStore();
					if (!(store instanceof QuadStore)) throw new Error("the world's store isn't a QuadStore, which routes a graph to a backing store");
					await remote.connect();
					await store.registerStore(remote, ["Widget"]);
				},
			};
			steps = declareSteps({
				read: {
					description: TEST_STEP,
					gwta: "read a widget",
					contract: { assumed: true, changes: [field(WIDGET, "colour")] },
					action: async () => {
						await this.getWorld().shared.getStore().merge({ "@type": "Widget", id: "w-7", colour: "red" });
						return actionOK();
					},
				},
			});
		}
		const result = await passWithDefaults("read a widget\n", [ReadsWidgets, ...(await getSteppers([LOGIC_STEPPER]))]);
		expect(await backing.get("w-7", "colour", "Widget"), "the serving store holds the record").toBe("red");
		const checks = result.featureResults?.[0]?.stepResults.at(-1)?.contract?.checks;
		expect(checks, "the step's record holds the check of the record the serving store wrote").toContain(`<${CHECK_NAMESPACE}${ASSUMED_CHECK}>`);
		expect(checks, "which read the record's colour through the serving instance").toContain('"red"');
	});
});

import { describe, it, expect, beforeEach } from "vitest";
import { Access, LinkRelations } from "../../domains/resources.js";
import { accessBound, inCall, inStep, runInCall, writeBound, writesInFlight } from "../../domains/capability-context.js";
import { storeDeclaring } from "../../test/declared-types.js";
import type { QuadStore } from "./quad-store.js";
import { relationChange, type TStepWrites } from "../domains/contract.js";
import { referenceTo, WriteOutsideContract } from "../../records/domains/unit.js";

const [CAPABILITY, NOTE, BODY, STEP_RECORD, TIME] = ["Capability", "Note", "Body", "SeqPath", "2026-11-08T00:00:00.000Z"];
/** A Capability owns its Body, and a Note reaches a Capability it mentions. */
const OWNS_BODY = { hasBody: { ranges: [BODY], owns: true, reference: false, functional: false, observesActuality: false } };
const MENTIONS_REL = LinkRelations.MENTIONS.rel;
const MENTIONS = { [MENTIONS_REL]: { ranges: [CAPABILITY], owns: false, reference: true, functional: false, observesActuality: false } };
/** A Note's edge to the step that observed it, which records what actuality did. */
const OBSERVED_REL = "observedIn";
const OBSERVED = { [OBSERVED_REL]: { ranges: [STEP_RECORD], owns: false, reference: true, functional: false, observesActuality: true } };
const DELEGATE = "CredentialsStepper-delegate";
/** The writes of a step whose products are Capabilities and whose contract lists a Note's `revoked`, with the writes refused during the step. */
const delegates = (): TStepWrites => ({
	step: DELEGATE,
	products: [CAPABILITY],
	changes: [{ persistedAs: NOTE, key: "revoked" }],
	typeOf: [],
	unitsGiven: false,
	refused: [],
	written: [],
});
let DELEGATES = delegates();
const inStepAt = <T>(seqPath: string, writes: TStepWrites | undefined, within: () => Promise<T>): Promise<T> =>
	runInCall(inStep(inCall(), { seqPath, reportsAt: undefined, writes }), within);

describe("a unit written in a step with a contract", () => {
	let store: QuadStore;
	beforeEach(() => {
		DELEGATES = delegates();
		store = storeDeclaring(
			{ [CAPABILITY]: { edges: OWNS_BODY }, [NOTE]: { edges: { ...MENTIONS, ...OBSERVED } }, [BODY]: {}, [STEP_RECORD]: { observesActuality: true } },
			{ bound: accessBound, writeBound, declared: (type) => ({ type, levels: [Access.public] }), stepWrites: writesInFlight, currentStep: () => undefined, recordTime: () => TIME },
		);
	});
	const held = (label: string, id: string) => store.query({ subject: id, namedGraph: label });

	it("is written in one operation where the contract allows each part, another caller reads it at once, and the step lists its parts", async () => {
		const owning: TStepWrites = { ...DELEGATES, changes: [...DELEGATES.changes, { persistedAs: BODY, key: "text" }] };
		await inStepAt("0.1", owning, () => store.create({ "@type": CAPABILITY, id: "cap-1", controller: "did:a", hasBody: { id: "cap-1-body", text: "signed" } }));
		expect(await store.get("cap-1", "controller", CAPABILITY)).toBe("did:a");
		expect(await store.get("cap-1-body", "text", BODY), "the Body the Capability owns is written with it").toBe("signed");
		expect(owning.written, "the step's written records hold each part").toEqual([
			{ label: BODY, id: "cap-1-body" },
			{ label: CAPABILITY, id: "cap-1" },
		]);
	});

	it("refuses a unit whose owned part changes what the contract doesn't list, and doesn't write any of its parts", async () => {
		const owned = inStepAt("0.1", DELEGATES, () => store.create({ "@type": CAPABILITY, id: "cap-3", controller: "did:a", hasBody: { id: "cap-3-body", text: "signed" } }));
		await expect(owned).rejects.toThrow(`${DELEGATE} writes ${BODY}.text`);
		expect(await held(CAPABILITY, "cap-3"), "the owner isn't written without its part").toEqual([]);
		expect(await held(BODY, "cap-3-body")).toEqual([]);
	});

	it("doesn't count a field a node restates as the store holds it, the record's id and level included", async () => {
		await store.create({ "@type": NOTE, id: "n-8", says: "kept", accessLevel: Access.public });
		await inStepAt("0.1", DELEGATES, () => store.merge({ "@type": NOTE, id: "n-8", says: "kept", accessLevel: Access.public, revoked: "2026-11-08" }));
		expect(await store.get("n-8", "revoked", NOTE)).toBe("2026-11-08");
		expect(DELEGATES.refused).toEqual([]);
	});

	it("is refused where it writes outside the contract, names the step and each write, and isn't made", async () => {
		const outside = inStepAt("0.1", DELEGATES, () => store.merge({ "@type": NOTE, id: "n-1", says: "kept" }));
		await expect(outside).rejects.toThrow(WriteOutsideContract);
		expect(DELEGATES.refused, "the step's record lists each refused write").toEqual([`${NOTE}.says`]);
		await expect(inStepAt("0.1", DELEGATES, () => store.merge({ "@type": NOTE, id: "n-1", says: "kept" }))).rejects.toThrow(
			`${DELEGATE} writes ${NOTE}.says, which its contract's products and changes don't list`,
		);
		expect(await held(NOTE, "n-1")).toEqual([]);
	});

	it("writes a field the contract's changes list, and refuses a field and an edge of the same record they don't", async () => {
		await store.merge({ "@type": NOTE, id: "n-2", says: "kept" });
		await inStepAt("0.1", DELEGATES, () => store.merge({ "@type": NOTE, "@id": "n-2", revoked: "2026-11-08" }));
		expect(await store.get("n-2", "revoked", NOTE)).toBe("2026-11-08");
		await expect(inStepAt("0.1", DELEGATES, () => store.merge({ "@type": NOTE, "@id": "n-2", says: "changed" }))).rejects.toThrow(`${NOTE}.says`);
		await expect(inStepAt("0.1", DELEGATES, () => store.merge({ "@type": NOTE, "@id": "n-2", mentions: referenceTo(CAPABILITY, "cap-1") }))).rejects.toThrow(`${NOTE}.mentions`);
		expect(DELEGATES.refused, "each refused write, and not the write the contract allows").toEqual([`${NOTE}.says`, `${NOTE}.mentions`]);
		expect(await store.get("n-2", "says", NOTE)).toBe("kept");
	});

	it("writes an edge of a relation the contract's changes list for a record of any type, and refuses another field of that record", async () => {
		const mentioning: TStepWrites = { ...DELEGATES, changes: [relationChange(MENTIONS_REL)] };
		await store.merge({ "@type": NOTE, id: "n-9", says: "kept" });
		await inStepAt("0.1", mentioning, () => store.merge({ "@type": NOTE, "@id": "n-9", [MENTIONS_REL]: referenceTo(CAPABILITY, "cap-1") }));
		expect(await store.query({ subject: "n-9", predicate: MENTIONS_REL })).toHaveLength(1);
		await expect(inStepAt("0.1", mentioning, () => store.merge({ "@type": NOTE, "@id": "n-9", says: "changed" }))).rejects.toThrow(`${NOTE}.says`);
	});

	it("keeps the units already written when a later unit is refused, each one whole", async () => {
		const writes = inStepAt("0.1", DELEGATES, async () => {
			await store.merge({ "@type": CAPABILITY, id: "cap-2", controller: "did:b" });
			await store.merge({ "@type": NOTE, id: "n-3", says: "refused" });
		});
		await expect(writes).rejects.toThrow(WriteOutsideContract);
		expect(await store.get("cap-2", "controller", CAPABILITY)).toBe("did:b");
		expect(await held(NOTE, "n-3")).toEqual([]);
	});

	it("checks each write against the innermost step's contract where steps nest", async () => {
		const notes: TStepWrites = { step: "NotesStepper-note", products: [NOTE], changes: [], typeOf: [], unitsGiven: false, refused: [], written: [] };
		await inStepAt("0.1", DELEGATES, () => inStepAt("0.1.1", notes, () => store.merge({ "@type": NOTE, id: "n-4", says: "the inner step's product" })));
		expect(await store.get("n-4", "says", NOTE)).toBe("the inner step's product");
		await expect(inStepAt("0.1", notes, () => inStepAt("0.1.1", DELEGATES, () => store.merge({ "@type": NOTE, id: "n-5", says: "outside" })))).rejects.toThrow(DELEGATE);
	});

	it("doesn't check a write outside any step, a write in a step that doesn't declare its changes, or a record or an edge whose declaration records what actuality did", async () => {
		await store.merge({ "@type": NOTE, id: "n-6", says: "outside a step" });
		await inStepAt("0.1", undefined, () => store.merge({ "@type": NOTE, id: "n-7", says: "a step on the contracts baseline" }));
		await inStepAt("0.1", DELEGATES, () => store.merge({ "@type": STEP_RECORD, id: "0.1", status: "running" }));
		await inStepAt("0.1", DELEGATES, () => store.merge({ "@type": NOTE, "@id": "n-6", [OBSERVED_REL]: referenceTo(STEP_RECORD, "0.1") }));
		expect(DELEGATES.refused, "the check doesn't refuse the step's record or the edge that records what actuality did").toEqual([]);
		expect([await store.get("n-6", "says", NOTE), await store.get("n-7", "says", NOTE), await store.get("0.1", "status", STEP_RECORD)]).toEqual([
			"outside a step",
			"a step on the contracts baseline",
			"running",
		]);
	});
});

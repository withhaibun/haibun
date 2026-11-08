import { describe, it, expect, beforeEach } from "vitest";
import { Access } from "../../domains/resources.js";
import { accessBound, runInStep, stepInFlight, writeBound } from "../../domains/capability-context.js";
import { storeDeclaring } from "../../test/declared-types.js";
import type { QuadStore } from "./quad-store.js";
import type { TStepWrites } from "../domains/contract.js";
import { WriteOutsideContract } from "../../records/derivations/contract-writes.js";

const [CAPABILITY, NOTE, BODY, STEP_RECORD] = ["Capability", "Note", "Body", "SeqPath"];
const DELEGATE = "CredentialsStepper-delegate";
/** The writes of a step whose products are Capabilities and whose contract lists a Note's `revoked`, with the writes refused during the step. */
const delegates = (): TStepWrites => ({ step: DELEGATE, products: [CAPABILITY], changes: [{ persistedAs: NOTE, key: "revoked" }], refused: [] });
let DELEGATES = delegates();
const inStep = <T>(seqPath: string, writes: TStepWrites | undefined, within: () => Promise<T>): Promise<T> => runInStep({ seqPath, reportsAt: undefined, writes }, within);

describe("a unit written in a step with a contract", () => {
	let store: QuadStore;
	beforeEach(() => {
		DELEGATES = delegates();
		store = storeDeclaring(
			{ [CAPABILITY]: {}, [NOTE]: {}, [BODY]: {}, [STEP_RECORD]: {} },
			{
				bound: accessBound,
				writeBound,
				declared: () => Access.public,
				stepWrites: () => stepInFlight()?.writes,
				recordsActuality: (label) => label === STEP_RECORD,
				currentStep: () => undefined,
			},
		);
	});
	const held = (label: string, id: string) => store.query({ subject: id, namedGraph: label });

	it("is written in one operation where the contract allows it, and another caller reads it at once", async () => {
		await inStep("0.1", DELEGATES, () =>
			store.write({ label: CAPABILITY, record: { id: "cap-1", controller: "did:a" }, owns: [{ label: BODY, record: { id: "cap-1-body", text: "signed" } }] }),
		);
		expect(await store.get("cap-1", "controller", CAPABILITY)).toBe("did:a");
		expect(await store.get("cap-1-body", "text", BODY), "a record the product owns is part of the product").toBe("signed");
	});

	it("is refused where it writes outside the contract, names the step and each write, and isn't made", async () => {
		const outside = inStep("0.1", DELEGATES, () => store.write({ label: NOTE, record: { id: "n-1", says: "kept" } }));
		await expect(outside).rejects.toThrow(WriteOutsideContract);
		expect(DELEGATES.refused, "the step's record lists each refused write").toEqual([`${NOTE}.id`, `${NOTE}.says`]);
		await expect(inStep("0.1", DELEGATES, () => store.write({ label: NOTE, record: { id: "n-1", says: "kept" } }))).rejects.toThrow(
			`${DELEGATE} writes ${NOTE}.id, ${NOTE}.says, which its contract's products and changes don't list`,
		);
		expect(await held(NOTE, "n-1")).toEqual([]);
	});

	it("writes a field the contract's changes list, and refuses a field and an edge of the same record they don't", async () => {
		await store.write({ label: NOTE, record: { id: "n-2", says: "kept" } });
		await inStep("0.1", DELEGATES, () => store.write({ label: NOTE, id: "n-2", fields: { revoked: "2026-11-08" } }));
		expect(await store.get("n-2", "revoked", NOTE)).toBe("2026-11-08");
		await expect(inStep("0.1", DELEGATES, () => store.write({ label: NOTE, id: "n-2", fields: { says: "changed" } }))).rejects.toThrow(`${NOTE}.says`);
		const edge = { label: NOTE, id: "n-2", fields: {}, edges: [{ rel: "mentions", label: CAPABILITY, id: "cap-1", target: "reference" as const }] };
		await expect(inStep("0.1", DELEGATES, () => store.write(edge))).rejects.toThrow(`${NOTE}.mentions`);
		expect(DELEGATES.refused, "each refused write, and not the write the contract allows").toEqual([`${NOTE}.says`, `${NOTE}.mentions`]);
		expect(await store.get("n-2", "says", NOTE)).toBe("kept");
	});

	it("keeps the units already written when a later unit is refused, each one whole", async () => {
		const writes = inStep("0.1", DELEGATES, async () => {
			await store.write({ label: CAPABILITY, record: { id: "cap-2", controller: "did:b" } });
			await store.write({ label: NOTE, record: { id: "n-3", says: "refused" } });
		});
		await expect(writes).rejects.toThrow(WriteOutsideContract);
		expect(await store.get("cap-2", "controller", CAPABILITY)).toBe("did:b");
		expect(await held(NOTE, "n-3")).toEqual([]);
	});

	it("checks each write against the innermost step's contract where steps nest", async () => {
		const notes: TStepWrites = { step: "NotesStepper-note", products: [NOTE], changes: [], refused: [] };
		await inStep("0.1", DELEGATES, () => inStep("0.1.1", notes, () => store.write({ label: NOTE, record: { id: "n-4", says: "the inner step's product" } })));
		expect(await store.get("n-4", "says", NOTE)).toBe("the inner step's product");
		await expect(inStep("0.1", notes, () => inStep("0.1.1", DELEGATES, () => store.write({ label: NOTE, record: { id: "n-5", says: "outside" } })))).rejects.toThrow(DELEGATE);
	});

	it("doesn't check a write outside any step, a write in a step that doesn't declare its changes, or actuality's record of itself", async () => {
		await store.write({ label: NOTE, record: { id: "n-6", says: "outside a step" } });
		await inStep("0.1", undefined, () => store.write({ label: NOTE, record: { id: "n-7", says: "a step on the contracts baseline" } }));
		await inStep("0.1", DELEGATES, () => store.write({ label: STEP_RECORD, record: { id: "0.1", status: "running" } }));
		expect([await store.get("n-6", "says", NOTE), await store.get("n-7", "says", NOTE), await store.get("0.1", "status", STEP_RECORD)]).toEqual([
			"outside a step",
			"a step on the contracts baseline",
			"running",
		]);
	});
});

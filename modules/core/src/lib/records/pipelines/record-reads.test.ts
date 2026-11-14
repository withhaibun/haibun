import { describe, it, expect } from "vitest";
import { storeDeclaring } from "../../test/declared-types.js";
import { GraphQuerySchema } from "../../steps/domains/quad-types.js";
import { recordWithEdges, unitOf } from "./record-reads.js";

const [NOTE, RESOURCE, SELECTOR, BODY] = ["Note", "SpecificResource", "TextQuoteSelector", "Body"];
/** A Note owns its Body and the SpecificResource it anchors, which owns its selector. */
const store = () =>
	storeDeclaring({
		[NOTE]: {
			edges: {
				hasBody: { ranges: [BODY], owns: true, reference: false, functional: false, observesActuality: false },
				target: { ranges: [RESOURCE], owns: true, reference: false, functional: false, observesActuality: false },
			},
		},
		[RESOURCE]: { edges: { hasSelector: { ranges: [SELECTOR], owns: true, reference: false, functional: false, observesActuality: false } } },
		[SELECTOR]: {},
		[BODY]: {},
	});
const NOTE_UNIT = { "@type": NOTE, id: "n-1", hasBody: { id: "n-1-body", content: "the text" }, target: { id: "r-1", hasSelector: { id: "s-1", exact: "a passage" } } };

describe("a read of a unit", () => {
	it("returns the record with each record it owns embedded under its edge, transitively, in one read", async () => {
		const held = store();
		await held.create(NOTE_UNIT);
		expect(await unitOf(held, NOTE, "n-1")).toMatchObject({
			id: "n-1",
			hasBody: [{ id: "n-1-body", content: "the text" }],
			target: [{ id: "r-1", hasSelector: [{ id: "s-1", exact: "a passage" }] }],
		});
	});

	it("is the vertex of a record read with its edges, so a view reads its bodies' text from it", async () => {
		const held = store();
		await held.create(NOTE_UNIT);
		expect((await recordWithEdges(held, NOTE, "n-1"))?.vertex).toMatchObject({ hasBody: [{ id: "n-1-body", content: "the text" }] });
	});

	it("is refused for a read that doesn't name its records", async () => {
		await expect(store().readRecords(GraphQuerySchema.parse({ label: NOTE, owned: true }))).rejects.toThrow("name the records in named");
	});
});

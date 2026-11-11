import { describe, expect, it } from "vitest";
import { CLASS_LABEL, PROPERTY_LABEL } from "@haibun/core/lib/domains/resources.js";
import { DL_SYMBOL, FRAME_KIND } from "@haibun/core/lib/records/domains/axioms.js";
import { ONTOLOGY_FIELD } from "@haibun/core/lib/records/domains/ontology.js";
import { recordFrame } from "./record-frame.js";

const out = (type: string, name: string) => ({ type, direction: "out" as const, target: { [ONTOLOGY_FIELD.name]: name } });
const record = (name: string, edges: ReturnType<typeof out>[]) => ({ vertex: { [ONTOLOGY_FIELD.name]: name }, edges });

describe("the frame a record states", () => {
	it("is a Class record's class frame, with its superclasses from its edges", () => {
		const frame = recordFrame(CLASS_LABEL, record("Email", [out(ONTOLOGY_FIELD.subClassOf, "Message")]));
		expect(frame?.lines).toEqual([`Email ${DL_SYMBOL.subsumedBy} Message`]);
		expect(frame?.manchester).toBe(`${FRAME_KIND.class}: Email\n    SubClassOf: Message`);
	});
	it("is a Property record's property frame, with its domain and range from its edges", () => {
		const frame = recordFrame(PROPERTY_LABEL, record("author", [out(ONTOLOGY_FIELD.domain, "Email"), out(ONTOLOGY_FIELD.range, "Person")]));
		expect(frame?.lines).toEqual([
			`${DL_SYMBOL.some}author.${DL_SYMBOL.top} ${DL_SYMBOL.subsumedBy} Email`,
			`${DL_SYMBOL.top} ${DL_SYMBOL.subsumedBy} ${DL_SYMBOL.all}author.Person`,
		]);
		expect(frame?.manchester).toContain(`${FRAME_KIND.property}: author`);
	});
	it("is undefined for a record of another type", () => {
		expect(recordFrame("Email", record("m1", []))).toBeUndefined();
	});
});

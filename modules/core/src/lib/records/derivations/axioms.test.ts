import { describe, expect, it } from "vitest";
import { propertyAxioms, unionMembers } from "./axioms.js";

describe("a property's axioms", () => {
	it("states each class of its domain's and its range's union once, though several types name it", () => {
		const { dl, manchester } = propertyAxioms("attributedTo", ["SeqPath", "Comment", "SeqPath"], ["Principal", "Principal", "Person", "Principal"], []);
		expect(dl).toBe("∃attributedTo.⊤ ⊑ (SeqPath ⊔ Comment) · ⊤ ⊑ ∀attributedTo.(Principal ⊔ Person)");
		expect(manchester).toContain("Range: Principal or Person");
	});

	it("keeps the first of the names an IRI names", () => {
		expect(unionMembers(["a", "A", "b"], (name) => name.toLowerCase())).toEqual(["a", "b"]);
	});
});

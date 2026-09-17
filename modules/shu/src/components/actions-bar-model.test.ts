/**
 * What the actions bar works out before it draws anything: what to call the current context, read here without a browser.
 */
import { describe, it, expect } from "vitest";
import { anIndividual, aType } from "../schemas.js";
import { contextLabel, isEntitySelection } from "./actions-bar-model.js";

describe("what the bar calls the current context", () => {
	it("names one selected record, and counts several", () => {
		expect(contextLabel([anIndividual("Email", "msg-1")])).toBe("msg-1");
		expect(contextLabel([anIndividual("Email", "msg-1"), anIndividual("Email", "msg-2")])).toBe("2 items");
	});

	it("names a type by what the view behind it holds", () => {
		expect(contextLabel([aType("Email", [{ predicate: "subject", operator: "contains", value: "invoice" }])], { label: "Email", total: 12, folder: "INBOX" })).toBe(
			"Email: 12 in INBOX",
		);
	});

	it("names a type by the type itself where the view offers nothing, which is what a schema view offers", () => {
		expect(contextLabel([aType("Email")])).toBe("Email:");
	});

	it("is All with nothing selected, since the bar then acts on everything", () => {
		expect(contextLabel([])).toBe("All");
	});

	it("tells a selection of records from a type to query over", () => {
		expect(isEntitySelection([anIndividual("Email", "msg-1"), anIndividual("Email", "msg-2")])).toBe(true);
		expect(isEntitySelection([aType("Email")])).toBe(false);
		expect(isEntitySelection([])).toBe(false);
	});
});

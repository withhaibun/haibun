/**
 * A held derivation runs again where its source holds another entry, and reads the held value otherwise (CP7R3).
 */
import { describe, expect, it } from "vitest";
import { heldPerEntries, recordEntries } from "./held-per-entries.js";

describe("a derivation held per entries", () => {
	const counting = () => {
		let derivations = 0;
		const derive = heldPerEntries(recordEntries, (record: Record<string, unknown>) => ({ derivation: ++derivations, keys: Object.keys(record) }));
		return { derive, count: () => derivations };
	};

	it("reads the held value while the source holds the same entries", () => {
		const { derive, count } = counting();
		const source = { a: 1 };
		expect(derive(source)).toBe(derive(source));
		expect(count()).toBe(1);
	});

	it("derives again where an entry is added, replaced or removed", () => {
		const { derive, count } = counting();
		const source: Record<string, unknown> = { a: 1 };
		derive(source);
		source.b = 2;
		expect(derive(source).keys, "an added entry").toEqual(["a", "b"]);
		source.b = 3;
		derive(source);
		delete source.a;
		expect(derive(source).keys, "a removed entry").toEqual(["b"]);
		expect(count(), "one derivation for each change").toBe(4);
	});

	it("holds a value for each source apart", () => {
		const { derive, count } = counting();
		const one = { a: 1 };
		const other = { a: 1 };
		derive(one);
		derive(other);
		derive(one);
		expect(count()).toBe(2);
	});
});

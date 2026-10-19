/**
 * The engine's program in its runtime: it consults with autoload off, it negates only through naf/2, and the proofs of two
 * lines hold their outcomes apart, so they interleave at each effect.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startSwipl } from "./swipl.js";

describe("the engine's program", () => {
	it("doesn't negate with a bare \\+, since negation reads only the results of its line through naf/2", () => {
		const program = readFileSync(new URL("./haibun.pl", import.meta.url), "utf8");
		const bare = program.split("\n").filter((line) => line.includes("\\+") && !line.trimStart().startsWith("naf("));
		expect(bare).toEqual([]);
	});

	it("consults with autoload off, and holds the outcomes of two lines apart while both proofs are open", async () => {
		const engine = await startSwipl();
		expect(engine.attempt("first", "call(n1)")).toMatchObject({ need: "call", path: [] });
		expect(engine.attempt("second", "not(n1, [call(n2)])")).toMatchObject({ need: "open", path: [] });
		engine.record("second", "open", [], "opened");
		expect(engine.attempt("second", "not(n1, [call(n2)])")).toMatchObject({ need: "call", path: [1] });
		engine.record("first", "call", [], "passed");
		expect(engine.attempt("first", "call(n1)")).toMatchObject({ verdict: "proved" });
		engine.record("second", "call", [1], "failed");
		engine.record("second", "close", [], "closed");
		expect(engine.attempt("second", "not(n1, [call(n2)])")).toMatchObject({ verdict: "proved", proof: { reading: "not", parts: [{ verdict: "refuted" }] } });
		engine.forget("first");
		engine.forget("second");
		expect(engine.attempt("first", "call(n1)"), "a line's outcomes go once its proof completes").toMatchObject({ need: "call" });
	});
});

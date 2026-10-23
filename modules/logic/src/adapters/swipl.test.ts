/**
 * The engine's program in its runtime: it consults with autoload off, it negates only through naf/2, and the proofs of two
 * lines are held apart, so they interleave at each effect.
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

	it("consults with autoload off, and holds two lines' proofs apart while both are open", async () => {
		const engine = await startSwipl();
		expect(engine.prove("first", "call(n1)")).toMatchObject({ need: "call", path: [] });
		expect(engine.prove("second", "not(n1, [call(n2)])")).toMatchObject({ need: "open", path: [] });
		expect(engine.resume("second", "opened")).toMatchObject({ need: "call", path: [1] });
		expect(engine.resume("first", "passed")).toEqual({ verdict: "proved" });
		expect(engine.resume("second", "failed")).toMatchObject({ need: "close", request: { verdict: "proved", why: "none" } });
		expect(engine.resume("second", "closed")).toEqual({ verdict: "proved" });
		engine.forget("first");
		engine.forget("second");
		expect(() => engine.resume("first", "passed"), "a line's proof goes once it completes").toThrow(/failed in the step program/);
	});
});

/**
 * What is announced is what was stored.
 *
 * A reader is told a fact by the run announcing it and reads it back from the graph, so an announcement with no write
 * behind it is a fact that exists until the page reloads and then does not. This fails the build when a new emitter
 * announces a graph observation from somewhere that does not write one, which is how the two drifted apart before.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MODULES = fileURLToPath(new URL("../../../", import.meta.url));

/** Every source file of every module, by its path from the modules directory, tests aside. */
function sources(dir: string, from = ""): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		const rel = from ? `${from}/${name}` : name;
		if (statSync(path).isDirectory()) return name === "build" || name === "node_modules" ? [] : sources(path, rel);
		if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.endsWith(".d.ts")) return [];
		return [rel];
	});
}

describe("a graph observation is announced by what writes it", () => {
	// The one place that defines the announcement, and the one that writes a variable's quad and announces that same
	// quad. A store announces its own writes, which is the store's to declare (topology.announceWrites).
	const ANNOUNCE = ["core/src/lib/quad-types.ts", "core/src/lib/feature-variables.ts"];

	it("is announced only where the same fact is written", () => {
		const emitters = sources(MODULES).filter((f) => readFileSync(join(MODULES, f), "utf8").includes("emitQuadObservation("));
		const unexpected = emitters.filter((f) => !ANNOUNCE.includes(f));
		expect(
			unexpected,
			`${unexpected.join(", ")} announces a graph observation. An announcement says a fact reached the graph, so it is made where that fact is written; a reader reloading finds nothing behind an announcement made anywhere else.`,
		).toEqual([]);
	});
});

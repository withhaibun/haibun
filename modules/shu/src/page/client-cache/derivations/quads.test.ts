// The quads a device holds, read as each subject's access level: one map, built in one pass, whatever the read.
import { describe, it, expect } from "vitest";
import { LinkRelations } from "@haibun/core/lib/domains/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { levelsOf, subjectKey } from "./quads.js";

describe("each subject's level", () => {
	it("is read in one pass over 10,000 quads", () => {
		const quads: TQuad[] = Array.from({ length: 10_000 }, (_, n) => ({
			subject: `s${Math.floor(n / 4)}`,
			predicate: n % 4 === 0 ? LinkRelations.ACCESS_LEVEL.rel : "content",
			object: n % 4 === 0 ? "public" : `text ${n}`,
			namedGraph: "Comment",
			timestamp: n,
		}));
		let read = 0;
		const counted: Iterable<TQuad> = {
			*[Symbol.iterator]() {
				for (const quad of quads) {
					read += 1;
					yield quad;
				}
			},
		};
		const levels = levelsOf(counted);
		expect(read, "each quad is read once").toBe(10_000);
		expect(levels.size).toBe(2500);
		expect(levels.get(subjectKey({ subject: "s0", predicate: "", object: "", namedGraph: "Comment", timestamp: 0 }))).toBe("public");
	});
});

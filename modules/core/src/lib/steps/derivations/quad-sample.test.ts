import { describe, expect, it } from "vitest";
import { LinkRelations } from "../../resources.js";
import type { TQuad } from "../domains/quad-types.js";
import { sliceQuadsPerType } from "./quad-sample.js";

const TYPE = "Part";
const SORT = "generatedAtTime";
const declared = () => ({ defaultSort: SORT });

/** The quads of a record of TYPE begun at `at`, part of `parent` where one is named. */
const record = (subject: string, at: number, parent?: string): TQuad[] => [
	{ subject, predicate: SORT, object: new Date(at).toISOString(), namedGraph: TYPE, timestamp: at },
	...(parent === undefined ? [] : [{ subject, predicate: LinkRelations.PART_OF.rel, object: parent, objectType: TYPE, namedGraph: TYPE, timestamp: at }]),
];

/** A whole of two parts, each of three leaves, written in the order a run of them writes them: each part and its leaves
 *  before the next part. */
const tree = (): TQuad[] => [
	...record("whole", 0),
	...record("part-1", 1, "whole"),
	...[2, 3, 4].flatMap((at) => record(`leaf-1-${at}`, at, "part-1")),
	...record("part-2", 5, "whole"),
	...[6, 7, 8].flatMap((at) => record(`leaf-2-${at}`, at, "part-2")),
];

describe("a sample of a type's records", () => {
	it("holds each record after the record it is part of, and the records that have parts before the leaves of one depth", () => {
		const [cluster] = sliceQuadsPerType(tree(), 4, [], declared).clusters;
		expect(cluster?.sampledSubjects, "the whole, its parts, then the first leaf by the declared sort").toEqual(["whole", "part-1", "part-2", "leaf-1-2"]);
	});

	it("counts the records it leaves out under the record it holds that they are part of", () => {
		const [cluster] = sliceQuadsPerType(tree(), 4, [], declared).clusters;
		expect(cluster?.omittedCount).toBe(5);
		expect(cluster?.omittedUnder).toEqual({ "part-1": 2, "part-2": 3 });
	});

	it("holds a record that is part of one the store doesn't hold after every record of the held hierarchy", () => {
		const [cluster] = sliceQuadsPerType([...record("orphan", -1, "absent"), ...tree()], 3, [], declared).clusters;
		expect(cluster?.sampledSubjects).toEqual(["whole", "part-1", "part-2"]);
		expect(cluster?.omittedUnder, "the sample doesn't hold the orphan's parent").toEqual({ "part-1": 3, "part-2": 3 });
	});

	it("doesn't state omitted records under a record where it holds every record", () => {
		const [cluster] = sliceQuadsPerType(tree(), 100, [], declared).clusters;
		expect(cluster?.omittedUnder).toBeUndefined();
	});
});

/**
 * One specification, every conduit. A view calls a step through `conduit()` and doesn't read which implementation is
 * installed: the live one over `/rpc`, or the one a test installs to respond from its own function. A difference
 * between them is a difference in what a view is given, so each passes these cases rather than carrying a suite of
 * its own.
 *
 * What is specified is what a caller is given: the result of a follow, the failure of one the server refused, the
 * order in which a stream arrives, the seqPath with which a stream starts, and what a grouped call returns. Each
 * implementation arranges its own results, which `TConduitUnderTest` supplies.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { TConduit } from "../page/ports.js";
import type { TStreamChunk } from "../page/domains/links.js";
import { reads } from "../page/domains/links.js";

/** A conduit ready to call, with the results a case arranges for it. */
export type TConduitUnderTest = {
	conduit: TConduit;
	/** A call to `method` returns `value`. */
	answers(method: string, value: unknown): void;
	/** A call to `method` fails, as a server refusing it makes it fail. */
	fails(method: string, message: string): void;
	/** A stream of `method` delivers these chunks in order. */
	streams(method: string, chunks: TStreamChunk[]): void;
	/** The calls the steps received, in the order they were called. */
	asked(): Array<{ method: string; params: Record<string, unknown> }>;
	done?(): void | Promise<void>;
};

const METHOD = "TestStepper-read";

/** Run the specification against one conduit. `make` returns a conduit without a result arranged. */
export function describeConduit(name: string, make: () => TConduitUnderTest | Promise<TConduitUnderTest>): void {
	describe(`the conduit (${name})`, () => {
		let held: TConduitUnderTest;
		let conduit: TConduit;
		beforeEach(async () => {
			held = await make();
			conduit = held.conduit;
			return async () => {
				await held.done?.();
			};
		});

		it("gives a follow what the step returned", async () => {
			held.answers(METHOD, { rows: [1, 2] });
			expect(await conduit.follow(reads(METHOD, {}), "read the rows")).toEqual({ rows: [1, 2] });
		});

		it("calls the step the link named, with the parameters the link carried", async () => {
			held.answers(METHOD, { ok: true });
			await conduit.follow(reads(METHOD, { label: "Email", id: "a" }), "read one");
			expect(held.asked().filter((call) => call.method === METHOD)).toEqual([{ method: METHOD, params: { label: "Email", id: "a" } }]);
		});

		it("fails a follow the step refused, and gives the reason the step returned", async () => {
			held.fails(METHOD, "the step refused the call");
			await expect(conduit.follow(reads(METHOD, {}), "read the rows")).rejects.toThrow(/the step refused the call/);
		});

		it("starts a stream with a seqPath before a chunk arrives, and resolves with that seqPath", async () => {
			held.streams(METHOD, [{ text: "one" }, { text: "two" }] as TStreamChunk[]);
			const started: number[][] = [];
			const arrived: TStreamChunk[] = [];
			const answer = await conduit.followStream(reads(METHOD, {}), (chunk) => arrived.push(chunk), { why: "read as it comes", onStart: (seqPath) => started.push(seqPath) });
			expect(started.length, "one start, before any chunk").toBe(1);
			expect(answer.seqPath).toEqual(started[0]);
			expect(arrived.map((c) => (c as { text?: string }).text)).toEqual(["one", "two"]);
		});

		it("fails a stream at a chunk carrying an error, and doesn't deliver a chunk after it", async () => {
			held.streams(METHOD, [{ text: "one" }, { error: "the step stopped" }, { text: "three" }] as TStreamChunk[]);
			const arrived: TStreamChunk[] = [];
			await expect(conduit.followStream(reads(METHOD, {}), (chunk) => arrived.push(chunk), { why: "read as it comes" })).rejects.toThrow(/the step stopped/);
			expect(arrived.map((c) => (c as { text?: string }).text)).toEqual(["one"]);
		});

		it("gives a group what its own function returned, and serves a follow made through the conduit it passes", async () => {
			held.answers(METHOD, { rows: [7] });
			const got = await conduit.group("read a few", async (g) => {
				const one = await g.follow<{ rows: number[] }>(reads(METHOD, {}), "read the rows");
				return one.rows.length;
			});
			expect(got).toBe(1);
		});
	});
}

import { describe, it, expect } from "vitest";
import { ChangedSinceRead } from "../domains/unit.js";
import { rereadAndRetry } from "./record-versions.js";

const refusal = () => new ChangedSinceRead({ label: "Comment", id: "c1" }, "1", "2");

describe("a write made from a read of its record", () => {
	it("runs again after a refusal of a record that changed since its read, and returns what the written attempt returns", async () => {
		let runs = 0;
		const written = await rereadAndRetry(3, () => {
			runs++;
			return runs < 3 ? Promise.reject(refusal()) : Promise.resolve("written");
		});
		expect([written, runs]).toEqual(["written", 3]);
	});

	it("throws the last refusal with the number of runs where every run is refused", async () => {
		await expect(rereadAndRetry(2, () => Promise.reject(refusal()))).rejects.toThrow(
			'Comment "c1" changed since it was read: the write states version 1, and the store holds version 2. Read the record again and write from what the store holds. The write was refused 2 times',
		);
	});

	it("throws another error at once", async () => {
		let runs = 0;
		const failing = rereadAndRetry(3, () => {
			runs++;
			return Promise.reject(new Error("the unit's record breaks its schema"));
		});
		await expect(failing).rejects.toThrow("breaks its schema");
		expect(runs).toBe(1);
	});
});

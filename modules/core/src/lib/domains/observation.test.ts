import { describe, it, expect } from "vitest";
import { isObserving, observationsSettled, observing } from "./observation.js";
import { StoreClosingError, isStoreClosing } from "./store-closing.js";

describe("an observing write", () => {
	it("marks what runs within it as observation, and leaves what runs outside it unmarked", async () => {
		const within = await observing(async () => {
			await Promise.resolve();
			return isObserving();
		});
		expect(within).toBe(true);
		expect(isObserving()).toBe(false);
	});

	it("is waited for by a close that begins while it runs, and a write begun after the close begins isn't", async () => {
		let finish: () => void = () => undefined;
		let finished = false;
		void observing(() => new Promise<void>((done) => (finish = done))).then(() => (finished = true));
		const settled = observationsSettled();
		void observing(() => new Promise<void>(() => undefined));
		finish();
		await settled;
		expect(finished).toBe(true);
	});
});

describe("a closing store's refusal", () => {
	it("differs from another failure by its type, where an error states it as its cause", () => {
		const refused = new StoreClosingError("a write");
		expect(isStoreClosing(refused)).toBe(true);
		expect(isStoreClosing(new Error("the write failed", { cause: refused }))).toBe(true);
		expect(isStoreClosing(new Error("the store is closed or closing"))).toBe(false);
	});
});

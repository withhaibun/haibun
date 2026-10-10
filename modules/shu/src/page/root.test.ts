// @vitest-environment jsdom
/**
 * Each bundle on a page holds its own copy of the root module, and every copy reads the ports the first installed: one
 * conduit, one event stream, one clock, one store of preferences. A second import of the module under another address stands for a
 * second bundle's copy.
 */
import { requiredActionOf } from "./controllers/registry-controller.js";
import { afterEach, describe, expect, it } from "vitest";
import { endPage } from "./adapters/page-held.js";
import * as first from "./root.js";

/** The root module as another bundle loads it: the same source, a separate module instance. */
const secondCopy = async (): Promise<typeof first> => (await import(/* @vite-ignore */ `./root.js?bundle=${crypto.randomUUID()}`)) as typeof first;

describe("the page's root, as two bundles load it", () => {
	afterEach(() => endPage());

	it("is two copies of the module, which read one conduit, one event stream, one clock and one store of preferences", async () => {
		const second = await secondCopy();
		expect(second, "each import is its own module instance").not.toBe(first);
		const conduit = first.installServedConduit("", requiredActionOf);
		expect(second.pageConduit()).toBe(conduit);
		const stream = first.installCarriedEventStream();
		expect(second.pageEventStream()).toBe(stream);
		expect(second.streamStatus()).toBe(first.streamStatus());
		expect(second.pageClock()).toBe(first.pageClock());
		expect(second.pagePreferences()).toBe(first.pagePreferences());
	});
});

// @vitest-environment jsdom
/**
 * Where a view shows an artifact of the run: the run serves its artifacts only to a reader holding a private read, so a
 * served page reads one under its delegation and shows what it read at an object URL, and a page opened as a file reads
 * its artifacts beside itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { READS_THE_RUNS_ARTIFACTS } from "@haibun/core/lib/actions.js";

const state = { offline: false };
const reported: string[] = [];
vi.mock("./rpc-registry.js", () => ({ isOffline: () => state.offline }));
vi.mock("./page-key.js", () => ({ readingHeaders: (_url: string, action: string) => Promise.resolve({ "capability-invocation": `action="${action}"` }) }));
vi.mock("./client-log.js", () => ({ reportToRun: (_level: string, _source: string, message: string) => reported.push(message) }));

const { shownArtifact, shownOrReported } = await import("./artifact-url.js");

const SCREENSHOT = "/artifacts/featn-1/image/event-0.1.png";

describe("where a view shows an artifact of the run", () => {
	const fetched: Array<{ url: string; headers: Record<string, string> }> = [];
	let answer = () => new Response(new Blob(["png"]), { status: 200 });

	beforeEach(() => {
		state.offline = false;
		fetched.length = 0;
		reported.length = 0;
		answer = () => new Response(new Blob(["png"]), { status: 200 });
		vi.stubGlobal("fetch", (url: string, init: { headers: Record<string, string> }) => {
			fetched.push({ url, headers: init.headers });
			return Promise.resolve(answer());
		});
		URL.createObjectURL = () => `blob:shown-${fetched.length}`;
	});
	afterEach(() => vi.unstubAllGlobals());

	it("reads an artifact the run serves under the page's private read, once, and shows it at an object URL", async () => {
		expect(await shownArtifact(SCREENSHOT)).toBe("blob:shown-1");
		expect(fetched).toEqual([{ url: SCREENSHOT, headers: { "capability-invocation": `action="${READS_THE_RUNS_ARTIFACTS}"` } }]);
		expect(await shownArtifact(SCREENSHOT), "a view showing it again shows what was read").toBe("blob:shown-1");
		expect(fetched).toHaveLength(1);
	});

	it("shows an address outside the run's artifacts, and every artifact of a page opened as a file, as it is", async () => {
		expect(await shownArtifact("https://example.com/door.png")).toBe("https://example.com/door.png");
		state.offline = true;
		expect(await shownArtifact("./image/event-0.2.png")).toBe("./image/event-0.2.png");
		expect(fetched).toEqual([]);
	});

	it("tells the run why an artifact it refused isn't shown, and reads it again when a view next shows it", async () => {
		const refused = "/artifacts/featn-1/image/event-0.3.png";
		answer = () => new Response("not a call this caller may make", { status: 403 });
		expect(await shownOrReported(refused, "a view")).toBeUndefined();
		expect(reported).toEqual([`an artifact couldn't be shown: the run refused its artifact ${refused}: 403 not a call this caller may make`]);
		answer = () => new Response(new Blob(["png"]), { status: 200 });
		expect(await shownOrReported(refused, "a view")).toBe("blob:shown-2");
	});
});

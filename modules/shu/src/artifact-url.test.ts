// @vitest-environment jsdom
/**
 * Where a view shows an artifact of the run: the run serves its artifacts only to a reader holding a private read, so a
 * served page reads one under its delegation and shows what it read at an object URL, and a page opened as a file reads
 * its artifacts beside itself.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { READS_THE_RUNS_ARTIFACTS } from "@haibun/core/lib/actions.js";
import { shownArtifact, shownOrReported } from "./artifact-url.js";
import { openPageAuthority } from "./page-key.js";
import { carryARun, reportingTo, setupShuTest, type TReportedToRun, type TShuTestHandle } from "./test-setup.js";

const SCREENSHOT = "/artifacts/featn-1/image/event-0.1.png";
/** The source a view reports under, and what the run answers a read it allows with. */
const VIEW = "a view";
const readable = () => new Response(new Blob(["png"]), { status: 200 });
/** What the run delegated to the page's key: a private read of what it serves. */
const readingTheRun = () => ({ id: "urn:uuid:reader", invocationTarget: location.origin, allowedAction: [READS_THE_RUNS_ARTIFACTS], expires: "2099-01-01T00:00:00Z" });

describe("where a view shows an artifact of the run", () => {
	const fetched: Array<{ url: string; headers: Record<string, string> }> = [];
	const reported: TReportedToRun[] = [];
	let answer = readable;
	let controller: string;
	let t: TShuTestHandle;

	beforeEach(async () => {
		fetched.length = 0;
		reported.length = 0;
		answer = readable;
		const artifact = (url: string, init?: RequestInit) => {
			fetched.push({ url, headers: init?.headers as Record<string, string> });
			return answer();
		};
		t = setupShuTest({ dispatch: reportingTo(reported), artifact });
		URL.createObjectURL = () => `blob:shown-${fetched.length}`;
		({ controller } = await openPageAuthority(() => Promise.resolve({ delegations: [readingTheRun()] }), []));
	});
	afterEach(() => t.teardown());

	it("reads an artifact the run serves under the page's private read, once, and shows it at an object URL", async () => {
		expect(await shownArtifact(SCREENSHOT)).toBe("blob:shown-1");
		expect(fetched.map(({ url }) => url)).toEqual([SCREENSHOT]);
		expect(fetched[0].headers["capability-invocation"]).toContain(`action="${READS_THE_RUNS_ARTIFACTS}"`);
		expect(fetched[0].headers.authorization, "signed by the page's key").toContain(controller);
		expect(await shownArtifact(SCREENSHOT), "a view showing it again shows what was read").toBe("blob:shown-1");
		expect(fetched).toHaveLength(1);
	});

	it("shows an address outside the run's artifacts, and every artifact of a page opened as a file, as it is", async () => {
		expect(await shownArtifact("https://example.com/door.png")).toBe("https://example.com/door.png");
		carryARun();
		expect(await shownArtifact("./image/event-0.2.png")).toBe("./image/event-0.2.png");
		expect(fetched).toEqual([]);
	});

	it("tells the run why an artifact it refused isn't shown, and reads it again when a view next shows it", async () => {
		const refused = "/artifacts/featn-1/image/event-0.3.png";
		answer = () => new Response("not a call this caller may make", { status: 403 });
		expect(await shownOrReported(refused, VIEW)).toBeUndefined();
		const message = `an artifact couldn't be shown: the run refused its artifact ${refused}: 403 not a call this caller may make`;
		expect(reported).toEqual([{ level: "warn", source: VIEW, message, attributes: { url: refused } }]);
		answer = readable;
		expect(await shownOrReported(refused, VIEW)).toBe("blob:shown-2");
	});
});

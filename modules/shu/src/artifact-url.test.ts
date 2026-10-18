// @vitest-environment jsdom
/**
 * Tests the address where a view shows an artifact of actuality. Actuality serves its artifacts only to a reader that
 * holds a private read. A served page reads an artifact under its delegation and shows it at an object URL. A page
 * opened as a file reads its artifacts from its own directory.
 */
import { SIGNATURE_HEADER } from "@haibun/core/lib/signature-header.js";
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { READS_THE_RUNS_ARTIFACTS } from "@haibun/core/lib/actions.js";
import { artifactUrl, shownArtifact, shownOrReported } from "./artifact-url.js";
import { carryAnActuality, openReportingPage, reportingTo, setupShuTest, type TReportedToRun, type TShuTestHandle } from "./test/setup.js";

const SCREENSHOT = "/artifacts/featn-1/image/event-0.1.png";
/** The source a view reports under. */
const VIEW = "a view";
/** Actuality's response to a read it allows. */
const readable = () => new Response(new Blob(["png"]), { status: 200 });
/** Actuality's delegation of READS_THE_RUNS_ARTIFACTS to the page's key. */
const readingTheActuality = () => ({ id: "urn:uuid:reader", invocationTarget: location.origin, allowedAction: [READS_THE_RUNS_ARTIFACTS], expires: "2099-01-01T00:00:00Z" });

describe("where a view shows an artifact of actuality", () => {
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
		({ controller } = await openReportingPage(() => Promise.resolve({ delegations: [readingTheActuality()] })));
	});
	afterEach(() => t.teardown());

	it("reads an artifact under the page's private read, shows it at an object URL, and doesn't read it again", async () => {
		expect(await shownArtifact(SCREENSHOT)).toBe("blob:shown-1");
		expect(fetched.map(({ url }) => url)).toEqual([SCREENSHOT]);
		expect(itemAt(fetched, 0).headers["capability-invocation"]).toContain(`action="${READS_THE_RUNS_ARTIFACTS}"`);
		expect(itemAt(fetched, 0).headers[SIGNATURE_HEADER], "signed by the page's key").toContain(controller);
		expect(await shownArtifact(SCREENSHOT), "a view showing it again shows what was read").toBe("blob:shown-1");
		expect(fetched).toHaveLength(1);
	});

	it("doesn't change an address outside actuality's artifacts or any artifact address of a page opened as a file", async () => {
		expect(await shownArtifact("https://example.com/door.png")).toBe("https://example.com/door.png");
		carryAnActuality();
		expect(await shownArtifact("./image/event-0.2.png")).toBe("./image/event-0.2.png");
		expect(fetched).toEqual([]);
	});

	it("doesn't return a record's address of a scheme that runs in the page", () => {
		const SCRIPT = "javascript:alert(1)";
		expect(artifactUrl({ url: SCRIPT }), "a record's own address").toBeUndefined();
		expect(artifactUrl({ url: "https://example.com/door.png" })).toBe("https://example.com/door.png");
		carryAnActuality();
		expect(artifactUrl({ featureRelativePath: SCRIPT, path: "featn-1/image/event-0.4.png" }), "a page opened as a file reads the artifact from its own directory").toBe(
			"./image/event-0.4.png",
		);
	});

	it("reports to actuality why an artifact it refused isn't shown, and reads it again when a view next shows it", async () => {
		const refused = "/artifacts/featn-1/image/event-0.3.png";
		answer = () => new Response("not a call this caller may make", { status: 403 });
		expect(await shownOrReported(refused, VIEW)).toBeUndefined();
		const message = `an artifact couldn't be shown: actuality refused its artifact ${refused}: 403 not a call this caller may make`;
		expect(reported).toEqual([{ level: "warn", source: VIEW, message, attributes: { url: refused } }]);
		answer = readable;
		expect(await shownOrReported(refused, VIEW)).toBe("blob:shown-2");
	});
});

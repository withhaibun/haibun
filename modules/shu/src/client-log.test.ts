// @vitest-environment jsdom
import "fake-indexeddb/auto";
/**
 * The page's diagnostic channel to actuality. A failure the page catches is reported to actuality, and in development it also
 * fails fast; a page without a run to report to doesn't report.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportFailure, reportToRun } from "./client-log.js";
import { authorityRefusal, RefusedCall } from "@haibun/core/lib/rpc-wire.js";
import { endPage } from "./page-pinned.js";
import { carryARun, serveThePage, openReportingPage, reportingTo, setupShuTest, type TReportedToRun, type TShuTestHandle } from "./test-setup.js";
import { openPageAuthority } from "./page-key.js";

const SOURCE = "a view";

describe("the page's reports to actuality", () => {
	let t: TShuTestHandle | undefined;
	afterEach(() => {
		t?.teardown();
		serveThePage();
	});

	it("reports a caught failure to actuality, and fails fast in development", async () => {
		const reported: TReportedToRun[] = [];
		t = setupShuTest({ dispatch: reportingTo(reported) });
		await openReportingPage();
		const failure = new Error("the read was refused");
		expect(() => reportFailure(SOURCE, "the view could not be read", failure)).toThrow(failure);
		expect(reported).toEqual([{ level: "error", source: SOURCE, message: "the view could not be read: the read was refused" }]);
	});

	it("writes a report refused for authority that failed verification, as one revoked, to the console, and doesn't fail fast", async () => {
		const warned: unknown[][] = [];
		const warn = vi.spyOn(console, "warn").mockImplementation((...said: unknown[]) => void warned.push(said));
		t = setupShuTest({ dispatch: () => Promise.reject(new RefusedCall(authorityRefusal("the presented authority failed verification: revoked"))) });
		await openReportingPage();
		reportToRun("warn", SOURCE, "under revoked authority");
		await vi.waitFor(() => expect(warned).toHaveLength(1));
		warn.mockRestore();
		expect(String(warned[0]?.[0])).toContain("since the page's authority failed verification");
	});

	it("doesn't report where the page doesn't have a run to report to, or doesn't hold what reporting requires", async () => {
		const reported: TReportedToRun[] = [];
		t = setupShuTest({ dispatch: reportingTo(reported) });
		await openPageAuthority(undefined, []);
		reportToRun("warn", SOURCE, "without the report's action");
		await openReportingPage();
		carryARun();
		reportToRun("warn", SOURCE, "carried");
		t.teardown();
		t = undefined;
		endPage();
		reportToRun("warn", SOURCE, "without a conduit");
		expect(reported).toEqual([]);
	});
});

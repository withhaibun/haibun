/**
 * An unpacked extension loaded into the browser a run launches: its page opens at the origin the step derives from the
 * key its manifest pins, which is the id Chromium gives it. An extension that doesn't pin a key, and one named after a page is
 * open, are refused, stating why.
 */
import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { failWithDefaults, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { DEFAULT_DEST } from "@haibun/core/schema/protocol.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import StorageMem from "@haibun/storage-mem/storage-mem.js";
import WebPlaywright from "./web-playwright.js";
import { BrowserFactory } from "./BrowserFactory.js";

const EXTENSION = path.resolve(import.meta.dirname, "../test/browser-extension");
const steppers = [WebPlaywright, VariablesStepper, StorageMem];
/** The profile the browser keeps, given here so the test removes it: a run not given one makes one, removed as it exits. */
const profile = mkdtempSync(path.join(tmpdir(), "haibun-load-extension-"));
const options = {
	options: { DEST: DEFAULT_DEST },
	moduleOptions: {
		[getStepperOptionName(WebPlaywright, "STORAGE")]: "StorageMem",
		[getStepperOptionName(WebPlaywright, "HEADLESS")]: "true",
		[getStepperOptionName(WebPlaywright, WebPlaywright.PERSISTENT_DIRECTORY)]: profile,
	},
};
const unpinned = mkdtempSync(path.join(tmpdir(), "haibun-unpinned-extension-"));
writeFileSync(path.join(unpinned, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "unpinned", version: "1.0" }));

afterAll(async () => {
	await BrowserFactory.closeBrowsers();
	rmSync(unpinned, { recursive: true, force: true });
	rmSync(profile, { recursive: true, force: true });
});

describe("load the browser extension at {where}", () => {
	it("opens the extension's page at the origin its pinned key derives", { timeout: 60_000 }, async () => {
		const feature = [
			`set extension from load the browser extension at "${EXTENSION}"`,
			'compose page with "{extension.origin}/page.html"',
			"go to the page webpage",
			'see "a page of the test extension"',
		].join("\n");
		const result = await passWithDefaults([{ path: "/features/load.feature", content: feature }], steppers, options);
		expect(result.ok, JSON.stringify(result.featureResults?.[0]?.stepResults?.filter((step) => !step.ok))).toBe(true);
	});

	it("refuses an extension that doesn't pin a key, and one named after a page is open", { timeout: 60_000 }, async () => {
		const refusedFor = async (lines: string[]) => {
			const result = await failWithDefaults([{ path: "/features/refused.feature", content: lines.join("\n") }], steppers, options);
			return (result.featureResults?.[0]?.stepResults?.find((step) => !step.ok) as { errorMessage?: string } | undefined)?.errorMessage;
		};
		expect(await refusedFor([`load the browser extension at "${unpinned}"`])).toMatch(/doesn't pin a key in its manifest/);
		expect(await refusedFor([`go to the "file://${EXTENSION}/page.html" webpage`, `load the browser extension at "${EXTENSION}"`])).toMatch(/before any step opens a page/);
	});
});

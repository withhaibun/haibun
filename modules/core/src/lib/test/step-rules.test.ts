import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AStepper, type TStepperSteps } from "../steps/domains/stepper.js";
import { OK } from "../domains/protocol.js";
import { Access } from "../domains/resources.js";
import { declaredSteps, NEAR_DUPLICATE, nearDuplicates, ONE_CALL_SITE, oneCallSite, STARTS_WITHOUT_PARAMETERS, startsWithoutParameters } from "./step-rules.js";

/** What each demo step needs: an action, which a test doesn't gate. */
const ACTS = { capability: "DemoStepper:act", action: () => OK };
const STEPPER_FILE = "modules/demo/src/demo-stepper.ts";

class DemoStepper extends AStepper {
	description = "Steps whose patterns the rules read";
	steps = {
		openStore: { gwta: "open the store", ...ACTS },
		readStore: { gwta: "show the store", read: true, readsAt: Access.public, action: () => OK },
		watchEvery: { gwta: "watch every {seconds: number} seconds", ...ACTS },
		fetchPage: { gwta: "fetch page {page: string}", ...ACTS },
		fetchPageAgain: { gwta: "fetch page {page: string} again", ...ACTS },
		fetchAnyPage: { gwta: "fetch any page {page: string}", ...ACTS },
		fetchOther: { gwta: "fetch {page: string} {other: string}", ...ACTS },
		precluding: { gwta: "fetch page {page: string} twice", precludes: ["DemoStepper.fetchPage"], ...ACTS },
		blank: { exact: "", ...ACTS },
		quiet: { exact: "quiet", ...ACTS },
	} as const satisfies TStepperSteps;
}
class InheritingStepper extends DemoStepper {}

const keysOf = (found: { finding: string }[], rule: string) => found.filter(({ finding }) => finding.startsWith(rule)).map(({ finding }) => finding.slice(rule.length + 2));
const steps = () => declaredSteps([{ file: STEPPER_FILE, stepper: new DemoStepper() }]);

describe("the steps a stepper declares", () => {
	it("list a step a stepper inherits from another loaded stepper once, as the step of the stepper that declares it", () => {
		const declared = declaredSteps([
			{ file: STEPPER_FILE, stepper: new InheritingStepper() },
			{ file: STEPPER_FILE, stepper: new DemoStepper() },
		]);
		expect(new Set(declared.map(({ stepper }) => stepper))).toEqual(new Set(["DemoStepper"]));
		expect(declared).toHaveLength(Object.keys(new DemoStepper().steps).length);
	});

	it("flag a step without a parameter, not a read, whose line starts or keeps something", () => {
		expect(keysOf(startsWithoutParameters(steps()), STARTS_WITHOUT_PARAMETERS)).toEqual(["DemoStepper.openStore"]);
	});

	it("flag a pattern that is another's with one word more, apart from a placeholder more, a step that precludes it and the empty line", () => {
		expect(keysOf(nearDuplicates(steps()), NEAR_DUPLICATE)).toEqual(["DemoStepper.fetchPageAgain ~ DemoStepper.fetchPage", "DemoStepper.fetchAnyPage ~ DemoStepper.fetchPage"]);
	});
});

describe("the call sites of a step", () => {
	let repository = "";
	const write = (file: string, text: string) => {
		mkdirSync(dirname(join(repository, file)), { recursive: true });
		writeFileSync(join(repository, file), text);
	};
	beforeEach(() => {
		repository = mkdtempSync(join(tmpdir(), "haibun-step-rules-"));
		execFileSync("git", ["init", "-q"], { cwd: repository });
	});
	afterEach(() => rmSync(repository, { recursive: true, force: true }));

	it("count feature lines, a statement nested at a line's end, kireji calls and code that names a step, and flag a step with at most one", () => {
		write(STEPPER_FILE, "// the stepper names its own steps: openStore, fetchPage, quiet");
		write("tests/features/a.feature", "Feature: A\n    watch every 30 seconds\n    not fetch page home\n    quiet\n");
		write(
			"tests/features/b.feature.ts",
			'const { fetchPage: fetched } = withAction(new DemoStepper());\nexport const features = { B: [fetched({ page: "home" }), `watch every ${30} seconds`] };\n',
		);
		write("modules/demo/src/page.ts", 'call("DemoStepper-openStore");\n');
		write("modules/demo/src/demo.test.ts", 'call("DemoStepper-readStore"); call("DemoStepper-readStore");\n');
		const flagged = keysOf(oneCallSite(repository, steps()), ONE_CALL_SITE);
		expect(flagged, "a feature line, a template's line and a nested statement count").not.toContain("DemoStepper.watchEvery");
		expect(flagged, "a nested statement and a kireji call count").not.toContain("DemoStepper.fetchPage");
		expect(flagged, "a test isn't a call site, and a page's call over RPC is one").toEqual(
			expect.arrayContaining(["DemoStepper.openStore", "DemoStepper.readStore", "DemoStepper.quiet"]),
		);
	});
});

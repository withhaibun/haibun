import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AStepper } from "../steps/domains/stepper.js";
import { OK } from "../domains/protocol.js";
import { Access, LinkRelations } from "../domains/resources.js";
import { WRITE_VERB } from "../records/domains/unit.js";
import type { TList } from "../domains/lists.js";
import {
	DECLARED_STEPS,
	declaredSteps,
	FIXED_STATEMENT,
	fixedStatements,
	LIST_OPERATION,
	listOperations,
	REPOSITORY_FILE,
	stepCount,
	UNDECLARED_LIST,
	undeclaredLists,
	UNINDEXED_FILTER,
	unindexedFilters,
	UNUSED_SELECTION,
	NEAR_DUPLICATE,
	nearDuplicates,
	ONE_CALL_SITE,
	oneCallSite,
	OWN_PRODUCTS,
	ownProducts,
	STARTS_WITHOUT_PARAMETERS,
	startsWithoutParameters,
	UNEXERCISED,
	unexercised,
} from "./step-rules.js";
import { TEST_STEP } from "./test-step.js";
import { declareSteps } from "../steps/domains/stepper.js";

/** What each demo step needs: an action, which a test doesn't gate. */
const ACTS = { capability: "DemoStepper:act", description: TEST_STEP, action: () => OK };
const STEPPER_FILE = "modules/demo/src/demo-stepper.ts";

class DemoStepper extends AStepper {
	description = "Steps whose patterns the rules read";
	steps = declareSteps({
		openStore: { gwta: "open the store", ...ACTS },
		openKey: { gwta: "open a key", contract: { products: "key" }, ...ACTS },
		readStore: { description: TEST_STEP, gwta: "show the store", contract: { read: true }, readsAt: Access.public, action: () => OK },
		watchEvery: { gwta: "watch every {seconds: number} seconds", ...ACTS },
		fetchPage: { gwta: "fetch page {page: string}", ...ACTS },
		fetchPageAgain: { gwta: "fetch page {page: string} again", ...ACTS },
		fetchAnyPage: { gwta: "fetch any page {page: string}", ...ACTS },
		fetchOther: { gwta: "fetch {page: string} {other: string}", ...ACTS },
		precluding: { gwta: "fetch page {page: string} twice", precludes: ["DemoStepper.fetchPage"], ...ACTS },
		blank: { exact: "", ...ACTS },
		quiet: { exact: "quiet", ...ACTS },
		heading: { gwta: "Heading: {title: string}", ...ACTS },
	});
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

	it("flag a step without a parameter, not a read and without a product, whose line starts or keeps something", () => {
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
		const env = { ...process.env };
		delete env.GIT_DIR;
		delete env.GIT_WORK_TREE;
		delete env.GIT_INDEX_FILE;
		delete env.GIT_PREFIX;
		execFileSync("git", ["init", "-q"], { cwd: repository, env });
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

	it("count each read of a top-level constant that names a step, or of the property of it that holds the naming, as a call", () => {
		write(STEPPER_FILE, "");
		write(
			"modules/demo/src/calls.ts",
			'export const OPEN = "DemoStepper-openStore";\nexport const CALLS = { read: "DemoStepper-readStore", still: "quiet" } as const;\nexport const UNREAD = "fetchPage";\n',
		);
		write("modules/demo/src/page.ts", "call(OPEN); call(OPEN); call(CALLS.read); call(CALLS.read); call(CALLS.still);\n");
		const flagged = keysOf(oneCallSite(repository, steps()), ONE_CALL_SITE);
		expect(flagged, "two reads of the constant and two of its property are two calls each").not.toEqual(expect.arrayContaining(["DemoStepper.openStore"]));
		expect(flagged).not.toContain("DemoStepper.readStore");
		expect(flagged, "one read of a property is one call, and a constant that isn't read names its step once").toEqual(
			expect.arrayContaining(["DemoStepper.quiet", "DemoStepper.fetchPage"]),
		);
	});

	it("count a line whose first word a colon follows as its step's, as a heading states it", () => {
		write(STEPPER_FILE, "");
		write("tests/features/a.feature", "Heading: one\nHeading: two\n");
		expect(keysOf(oneCallSite(repository, steps()), ONE_CALL_SITE)).not.toContain("DemoStepper.heading");
	});
});

describe("the steps a repository exercises", () => {
	let repository = "";
	const write = (file: string, text: string) => {
		mkdirSync(dirname(join(repository, file)), { recursive: true });
		writeFileSync(join(repository, file), text);
	};
	beforeEach(() => {
		repository = mkdtempSync(join(tmpdir(), "haibun-step-exercise-"));
		const env = { ...process.env };
		delete env.GIT_DIR;
		delete env.GIT_WORK_TREE;
		delete env.GIT_INDEX_FILE;
		delete env.GIT_PREFIX;
		execFileSync("git", ["init", "-q"], { cwd: repository, env });
	});
	afterEach(() => rmSync(repository, { recursive: true, force: true }));

	it("count a feature line, a kireji call, a waypoint's line and a unit test that states, calls or names a step, and flag a step that they don't run", () => {
		write(STEPPER_FILE, "// the stepper names its own steps: openStore, readStore");
		write("tests/features/a.feature", "Feature: A\n    watch every 30 seconds\n");
		write("tests/features/b.feature.ts", 'const { fetchPage: fetched } = withAction(new DemoStepper());\nexport const features = { B: [fetched({ page: "home" })] };\n');
		write("modules/demo/waypoints/backgrounds/demo.feature.ts", 'export const backgrounds = { Demo: ["waypoint store shown with show the store"] };\n');
		write("modules/demo/src/demo.test.ts", 'new DemoStepper().steps.openKey.action({}); call("DemoStepper-fetchAnyPage"); run("fetch page home again");\n');
		write("modules/demo/src/page.ts", 'call("DemoStepper-openStore");\n');
		write("modules/other/src/other.test.ts", 'other.steps.quiet.action({}); call("OtherStepper-heading");\n');
		const flagged = keysOf(unexercised(repository, steps()), UNEXERCISED);
		// A feature line, a kireji call and a waypoint's line count, and so does a unit test that names the stepper and its step,
		// calls it over RPC or states its line: watchEvery, fetchPage, readStore, openKey, fetchAnyPage, fetchPageAgain and
		// fetchOther, whose pattern the test's line matches too.
		expect(flagged, "code that calls a step isn't a test of it, a test that doesn't name the stepper doesn't count, and the empty line's step isn't flagged").toEqual([
			"DemoStepper.openStore",
			"DemoStepper.precluding",
			"DemoStepper.quiet",
			"DemoStepper.heading",
		]);
	});
});

/** Steps whose patterns and products the list rules read. */
class ListingStepper extends AStepper {
	description = "Steps that read lists";
	cycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: ["rows"], schema: z.object({ rows: z.array(z.object({ id: z.string() })) }), description: "Rows without a declared list" },
				{ selectors: ["counted"], schema: z.object({ total: z.number(), saturated: z.boolean() }), description: "A count without a declared list" },
				{ selectors: ["listed"], schema: z.object({ rows: z.array(z.object({ id: z.string() })) }), list: { items: "rows" }, description: "Rows with their list" },
				{ selectors: ["names"], schema: z.object({ names: z.array(z.string()) }), description: "Names, which aren't records" },
			],
		}),
	};
	steps = declareSteps({
		firstRows: { description: TEST_STEP, gwta: "show the first {n: number} rows", readsAt: Access.public, contract: { read: true, products: "rows" }, action: () => OK },
		rowsMatching: { description: TEST_STEP, gwta: "show rows matching {text: string}", readsAt: Access.public, contract: { read: true, products: "counted" }, action: () => OK },
		rowsSince: { description: TEST_STEP, gwta: "show rows since {at: date}", readsAt: Access.public, contract: { read: true, products: "listed" }, action: () => OK },
		linesFromTo: {
			description: TEST_STEP,
			gwta: "show lines from {from: number} to {to: number}",
			readsAt: Access.public,
			contract: { read: true, products: "names" },
			action: () => OK,
		},
		resize: { gwta: "resize to {width: number}", ...ACTS },
		delegate: { gwta: "delegate reading until {expires: date}", ...ACTS },
		combine: { gwta: "limited to {count: number}, {statement: statement}", transformsList: () => (list: TList) => list, ...ACTS },
		selected: { gwta: "run the tests matching {filter: string}", ...ACTS },
	});
}
const listing = () => declaredSteps([{ file: STEPPER_FILE, stepper: new ListingStepper() }]);

describe("the lists steps read", () => {
	it("count each declared step under the repository", () => {
		expect(stepCount(listing())).toEqual(listing().map(() => ({ file: REPOSITORY_FILE, finding: DECLARED_STEPS })));
	});

	it("flag a pattern that filters, bounds, pages, orders or counts its own list, apart from a combinator, a selection with its reason and a step that acts until a time", () => {
		const selections = { "ListingStepper.selected": "matching names the tests a run runs", "ListingStepper.resize": "a width isn't a list's" };
		expect(keysOf(listOperations(listing(), selections), UNUSED_SELECTION), "a selection the rule doesn't flag").toEqual(["ListingStepper.resize"]);
		expect(keysOf(listOperations(listing(), selections), LIST_OPERATION)).toEqual([
			"ListingStepper.firstRows",
			"ListingStepper.rowsMatching",
			"ListingStepper.rowsSince",
			"ListingStepper.linesFromTo",
		]);
	});

	it("flag a domain of records or of a count that doesn't declare its list, apart from a list of values that aren't records", () => {
		expect(keysOf(undeclaredLists([{ stepper: new ListingStepper() }], listing()), UNDECLARED_LIST)).toEqual([
			"ListingStepper.firstRows (rows)",
			"ListingStepper.rowsMatching (counted)",
		]);
	});
});

/** Returns records of a stored type: through dispatch, itself, or as a read. */
class StoringStepper extends AStepper {
	description = "Steps that return records of a stored type";
	cycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: ["note"],
					schema: z.object({ id: z.string() }),
					description: "A stored note",
					topology: { persistedAs: "Note", accessLevel: Access.private, id: "id", properties: { id: LinkRelations.IDENTIFIER.rel } },
				},
				{ selectors: ["draft"], schema: z.object({ id: z.string() }), description: "A note that isn't stored" },
			],
		}),
	};
	steps = declareSteps({
		writtenByDispatch: { gwta: "note {id: string} through dispatch", contract: { products: "note", written: WRITE_VERB.create }, ...ACTS },
		writtenItself: { gwta: "note {id: string} itself", contract: { products: "note" }, ...ACTS },
		readNote: { gwta: "read note {id: string}", readsAt: Access.public, contract: { read: true, products: "note" }, ...ACTS },
		draft: { gwta: "draft {id: string}", contract: { products: "draft" }, ...ACTS },
	});
}

describe("the products a step writes", () => {
	it("flag a step that returns records of a stored type without contract.written, apart from a read and a type that isn't stored", () => {
		const stepper = new StoringStepper();
		expect(keysOf(ownProducts([{ stepper }], declaredSteps([{ file: STEPPER_FILE, stepper }])), OWN_PRODUCTS)).toEqual(["StoringStepper.writtenItself"]);
	});
});

describe("a step that only states other steps", () => {
	let repository = "";
	beforeEach(() => {
		repository = mkdtempSync(join(tmpdir(), "haibun-step-fixed-"));
	});
	afterEach(() => rmSync(repository, { recursive: true, force: true }));

	it("is flagged where its action ignores its input and states steps with fixed arguments, and not where an argument varies", () => {
		mkdirSync(dirname(join(repository, STEPPER_FILE)), { recursive: true });
		writeFileSync(
			join(repository, STEPPER_FILE),
			[
				"steps = {",
				'	openStore: { action: () => findFeatureStepsFromStatement("show the store", steppers, world) },',
				'	openKey: { action: (_: unknown) => this.steps.readStore.action({ label: "Comment" }) },',
				"	watchEvery: { action: ({ seconds }) => findFeatureStepsFromStatement(`watch ${seconds}`, steppers, world) },",
				"	readStore: { action: () => OK },",
				"};",
			].join("\n"),
		);
		expect(keysOf(fixedStatements(repository, steps()), FIXED_STATEMENT)).toEqual(["DemoStepper.openStore", "DemoStepper.openKey"]);
	});
});

describe("a quantifier's filter", () => {
	let repository = "";
	beforeEach(() => {
		repository = mkdtempSync(join(tmpdir(), "haibun-step-indexed-"));
		execFileSync("git", ["init", "-q"], { cwd: repository });
	});
	afterEach(() => rmSync(repository, { recursive: true, force: true }));

	/** A stepper that declares a domain whose members its store reads by `called`, and a domain whose members aren't indexed. */
	class MembersStepper extends AStepper {
		description = "Domains a quantifier ranges over";
		cycles = {
			getConcerns: () => ({
				domains: [
					{ selectors: ["records"], schema: z.string(), description: "Indexed members", members: { indexed: ["id", "called"], read: () => Promise.resolve([]) } },
					{ selectors: ["recent"], schema: z.string(), description: "Members a read returns whole", members: { read: () => Promise.resolve([]) } },
				],
			}),
		};
		steps = declareSteps({});
	}

	it("is flagged where it names a field the domain doesn't index, and not where the domain indexes it or doesn't index its members", () => {
		mkdirSync(join(repository, "tests/features"), { recursive: true });
		const lines = [
			'whose "called" is "X", ordered by "id", every r in records is passes',
			'whose "stepText" is "X", some r in records is passes',
			'whose "stepText" is "X", every r in recent is passes',
			'every r in records is whose "verdict" is "proved", some q in records is passes',
		];
		writeFileSync(join(repository, "tests/features/a.feature"), `Feature: A\n${lines.join("\n")}\n`);
		const found = unindexedFilters(repository, [{ stepper: new MembersStepper() }]);
		expect(found.map(({ finding }) => finding)).toEqual([`${UNINDEXED_FILTER}: records.stepText`, `${UNINDEXED_FILTER}: records.verdict`]);
	});
});

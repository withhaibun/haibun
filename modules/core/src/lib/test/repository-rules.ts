/**
 * The rules every repository built on haibun holds itself to, as one suite a repository's rules test calls with its roots: its source
 * held to the kinds of code, refusals and defaults of docs/architecture.md, to the one path of a call through the logic engine's
 * prover and the one read of the store through its reader; its steps held to the step rules; its prose held to the Writing rules;
 * and its groups, scripts and first-read documents held to the group rules. A file holds each finding at most as often as the
 * rule's baseline file, in the repository's baselines directory, records.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectWithinBaseline, REPOSITORY_SCAN_MS } from "./baseline.js";
import { codeKindFindings, UNPOSITIONED } from "./code-kinds.js";
import { composeFiles, defaultFindings } from "./default-rules.js";
import { brokenPaths, linksAndParentPaths, optionAssignments, trackedFiles, untrackedRecords } from "./group-rules.js";
import { proseFindings } from "./prose-baseline.js";
import { refusalFindings } from "./refusal-rules.js";
import { parsedSources, sourceFiles, type TPackages } from "./repository-files.js";
import {
	declaredSteps,
	fixedStatements,
	listOperations,
	nearDuplicates,
	oneCallSite,
	startsWithoutParameters,
	stepCount,
	steppersUnder,
	undeclaredLists,
	unexercised,
} from "./step-rules.js";
import { downstreamNameFindings, oneReadFindings, onePathFindings, vocabularyFindings } from "./surface-rules.js";

/** What a repository's rules read, each path from its root. */
export type TRepositoryRules = {
	/** The repository's root. */
	repository: string;
	/** The rules test, which an update of a baseline runs. */
	testFile: string;
	/** The directory that holds the baselines and the prose allowance file. */
	baselines: string;
	/** The roots of the code the code rules read: the source, the libraries of waypoints and the scripts. */
	codeRoots: readonly string[];
	/** Files of the code roots the read holds, which show it reads each root. */
	codeSamples: readonly string[];
	/** The workspace packages by name, through which one package imports another. */
	packages: TPackages;
	/** The roots of the steppers the step rules read. */
	stepperRoots: readonly string[];
	/** The steps whose pattern selects what they act on with a word a list operation also uses, each with why it isn't a list's. */
	inputSelections: Readonly<Record<string, string>>;
	/** The roots of the prose the Writing rules read, and the paths they leave out, such as a person's documents in progress. */
	prose: { roots: readonly string[]; exclude: readonly RegExp[] };
	/** The names of the applications built on the repository, which its files don't name, where it is a library. The rules test
	 *  that states them is the one file that names them. */
	downstreamNames?: readonly string[];
	/** The document whose vocabulary table names the terms of the concepts, where the repository holds one. */
	vocabularyTable?: string;
	/** Each group by its config, from the root, with the external environments it uses. */
	groups: () => readonly { config: string; environments: readonly string[] }[];
	/** A group directory the repository holds, which shows the groups are read. */
	groupSample: string;
	/** The documents a contributor reads first. */
	firstRead: readonly string[];
};

const described = (found: { file: string; finding: string }[]): string[] => found.map(({ file, finding }) => `${file} ${finding}`);

/** Registers the rules of a repository as tests. */
export function describeRepositoryRules(rules: TRepositoryRules): void {
	const { repository, testFile } = rules;
	const baseline = (name: string): string => join(rules.baselines, `${name}.baseline.json`);
	const files = sourceFiles(repository, rules.codeRoots);
	const sources = parsedSources(repository, files);

	describe(
		"the code of this repository",
		() => {
			it("reads every code root", () => {
				expect(files).toEqual(expect.arrayContaining([...rules.codeSamples]));
			});

			it("places each file in a kind position that imports only its row's kinds, apart from what code-kinds.baseline.json records (CR1)", async () => {
				const fix = `move a file that ${UNPOSITIONED} into its kind's directory, and import only the kinds its row of haibun's docs/architecture.md lists`;
				await expectWithinBaseline({ baselineFile: baseline("code-kinds"), found: codeKindFindings(repository, { sources, packages: rules.packages }), testFile, fix });
			});

			it("states each refusal's cause and carries a remedy a caller can act on, apart from what refusals.baseline.json records (CR5)", async () => {
				const fix = "state what failed and why in the refusal's own words, and carry the remedy a caller can act on as data";
				await expectWithinBaseline({ baselineFile: baseline("refusals"), found: refusalFindings(sources), testFile, fix });
			});

			it("doesn't state a default value, apart from what defaults.baseline.json records (CR8)", async () => {
				const fix = "refuse the absent value with a message that names what supplies it, or type it as optional and read its absence by name";
				await expectWithinBaseline({ baselineFile: baseline("defaults"), found: defaultFindings(repository, sources, composeFiles(repository)), testFile, fix });
			});

			it("reaches step dispatch and a step's action only through the logic engine's prover, apart from what one-path.baseline.json records", async () => {
				const fix = "prove the step through proveStep, which dispatches each call of its proof";
				await expectWithinBaseline({ baselineFile: baseline("one-path"), found: onePathFindings(sources), testFile, fix });
			});

			it("reads the store in the logic engine only through its reader, apart from what one-read.baseline.json records", async () => {
				const fix = "read the store through readerOf in haibun's modules/logic/src/pipelines/reads.ts, which returns the engine's reads";
				await expectWithinBaseline({ baselineFile: baseline("one-read"), found: oneReadFindings(sources), testFile, fix });
			});

			const { vocabularyTable } = rules;
			if (vocabularyTable !== undefined)
				it("names each concept by its term, apart from what vocabulary.baseline.json records", async () => {
					const found = vocabularyFindings(repository, rules.prose.roots, vocabularyTable, rules.prose.exclude);
					const fix = `name the concept by the term the vocabulary table of ${vocabularyTable} states`;
					await expectWithinBaseline({ baselineFile: baseline("vocabulary"), found, testFile, fix });
				});

			const { downstreamNames } = rules;
			if (downstreamNames !== undefined)
				it("doesn't name an application built on it, apart from what downstream-names.baseline.json records", async () => {
					const found = downstreamNameFindings(
						repository,
						[...new Set([...rules.prose.roots, ...rules.codeRoots])],
						{ names: downstreamNames, statedIn: testFile },
						rules.prose.exclude,
					);
					const fix = "state the general concept, and move the application's example into the application's own repository";
					await expectWithinBaseline({ baselineFile: baseline("downstream-names"), found, testFile, fix });
				});
		},
		REPOSITORY_SCAN_MS,
	);

	describe(
		"the steps of this repository",
		() => {
			it("start what a feature needs through a parameter, have more than one call site, don't repeat a pattern with a word more or less, and are each exercised, apart from what steps.baseline.json records", async () => {
				const steppers = await steppersUnder(repository, rules.stepperRoots);
				const steps = declaredSteps(steppers);
				const found = [
					...startsWithoutParameters(steps),
					...oneCallSite(repository, steps),
					...nearDuplicates(steps),
					...unexercised(repository, steps),
					...stepCount(steps),
					...listOperations(steps, rules.inputSelections),
					...undeclaredLists(steppers, steps),
					...fixedStatements(repository, steps),
				];
				const fix =
					"start it as a feature starts where an option states it, make it a waypoint of a module's library, give a primitive the difference as a parameter, or exercise it in a feature or a unit test";
				await expectWithinBaseline({ baselineFile: baseline("steps"), found, testFile, fix });
			});
		},
		REPOSITORY_SCAN_MS,
	);

	describe(
		"the prose of this repository",
		() => {
			it("breaks each rule at most as often as its baseline records", async () => {
				const found = proseFindings(repository, { ...rules.prose, allowedFile: join(rules.baselines, "prose.allowed.json") });
				const fix = "rewrite the prose, or allow its text in prose.allowed.json with the reason it doesn't break the rule";
				await expectWithinBaseline({ baselineFile: baseline("prose"), found, testFile, fix });
			});
		},
		REPOSITORY_SCAN_MS,
	);

	describe("the groups, scripts and first-read documents of this repository", () => {
		it("leaves every option of haibun out of a script, so the config the script's command reads holds it (TX9)", () => {
			expect(described(optionAssignments(repository)), "move each option to the options or moduleOptions of the config the script's command reads").toEqual([]);
		});

		it("has scripts that stay valid shell where an argument follows, as a command that passes an option appends one (TX3)", () => {
			const scripts = trackedFiles(repository, "*package.json").flatMap((file) =>
				Object.entries((JSON.parse(readFileSync(join(repository, file), "utf-8")) as { scripts?: Record<string, string> }).scripts ?? {}).map(([name, script]) => ({
					file,
					name,
					script,
				})),
			);
			for (const { file, name, script } of scripts) {
				const checked = spawnSync("sh", ["-n", "-c", `${script} --with-steppers=debugger-stepper`], { encoding: "utf-8" });
				expect(checked.status, `${file} script ${name}: ${checked.stderr}`).toBe(0);
			}
		});

		it("doesn't commit a symbolic link, or name a parent path in a group's config, a package's script or a feature's import of a package's code", () => {
			expect(described(linksAndParentPaths(repository)), "name what the path names by its package, or move it into the group").toEqual([]);
		});

		it("tracks the actualities file of every group that runs without an environment, and of each instance under it, and every baseline", () => {
			const groups = [...new Set(rules.groups().flatMap(({ config, environments }) => (environments.length === 0 ? [dirname(config)] : [])))];
			expect(groups, "the configs declare the groups").toContain(rules.groupSample);
			expect(described(untrackedRecords(repository, groups)), "commit each file with the code it measures").toEqual([]);
		});

		it("names only paths that the repository holds (TX13)", () => {
			expect(described(brokenPaths(repository, rules.firstRead)), "correct each path or remove it").toEqual([]);
		});
	});
}

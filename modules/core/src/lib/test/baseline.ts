/**
 * Findings held to a baseline file that only shrinks. The file records how many of each finding each file holds. A count
 * above its record fails and names the finding to fix. A count below its record fails as well and names the command that
 * writes the lower counts, so the file holds each gain. The command doesn't write the file where a count rose.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Findings by the file that holds them, each finding with its count. */
export type TFindings = Record<string, Record<string, number>>;
/** One finding in a file, at the line it starts on where it has one. */
export type TFound = { file: string; finding: string; line?: number };
/** The environment variable that sets a baseline test to write its baseline with the findings that remain. */
export const LOWER_BASELINE = "HAIBUN_LOWER_BASELINE";

/** The findings a check holds to its baseline: counted already, or each found at its line, which a rise lists. */
type TBaselineCheck = {
	/** The JSON file that records the findings. */
	baselineFile: string;
	/** The test file by its path from the repository root, which the command runs. */
	testFile: string;
	/** What removes a finding the record doesn't hold. */
	fix: string;
} & ({ findings: TFindings } | { found: readonly TFound[] });
type TDifference = { file: string; finding: string; found: number; recorded: number };

/** The command that writes a test's baseline with the findings that remain. */
export const lowerCommand = (testFile: string): string => `${LOWER_BASELINE}=true npm test -- ${testFile}`;

/** Each count of `from` that differs from its count in `against`, where `rises` selects a count above it or below it. */
function differences(from: TFindings, against: TFindings, rises: boolean): TDifference[] {
	const files = [...new Set([...Object.keys(from), ...Object.keys(against)])].sort();
	return files.flatMap((file) => {
		const found = from[file] ?? {};
		const recorded = against[file] ?? {};
		return [...new Set([...Object.keys(found), ...Object.keys(recorded)])]
			.sort()
			.map((finding) => ({ file, finding, found: found[finding] ?? 0, recorded: recorded[finding] ?? 0 }))
			.filter(({ found, recorded }) => (rises ? found > recorded : found < recorded));
	});
}

const differenceLine = ({ file, finding, found, recorded }: TDifference): string => `  ${file}: ${finding} ${recorded} -> ${found}`;
/** A rise, and the line of each finding of its kind in its file. */
const riseLines = (rise: TDifference, sites: readonly TFound[]): string[] => [
	differenceLine(rise),
	...sites.filter(({ file, finding, line }) => file === rise.file && finding === rise.finding && line !== undefined).map(({ file, line }) => `    ${file}:${line}`),
];

/** The findings sorted by file and by finding, as the baseline file writes them. */
function sorted(findings: TFindings): TFindings {
	return Object.fromEntries(
		Object.entries(findings)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([file, counts]) => [file, Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))]),
	);
}

function isFindings(value: unknown): value is TFindings {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	return Object.values(value).every(
		(counts) =>
			typeof counts === "object" &&
			counts !== null &&
			!Array.isArray(counts) &&
			Object.values(counts).every((count) => typeof count === "number" && Number.isInteger(count) && count > 0),
	);
}

/** The findings a baseline file records. */
export function readBaseline(baselineFile: string): TFindings {
	const recorded: unknown = JSON.parse(readFileSync(baselineFile, "utf-8"));
	if (!isFindings(recorded)) throw new Error(`${baselineFile} doesn't hold findings by file, each finding with a positive whole count`);
	return recorded;
}

/** Fails where the findings differ from the baseline file. With the environment variable set, writes the file instead, unless a count rose. */
export function expectWithinBaseline(check: TBaselineCheck): void {
	const { baselineFile, testFile, fix } = check;
	const sites = "found" in check ? check.found : [];
	const findings = "found" in check ? countFindings(check.found) : check.findings;
	const command = lowerCommand(testFile);
	const recorded = existsSync(baselineFile) ? readBaseline(baselineFile) : undefined;
	const rises = recorded === undefined ? [] : differences(findings, recorded, true);
	if (process.env[LOWER_BASELINE] === "true") {
		if (rises.length > 0)
			throw new Error([`${command} writes only lower counts, and these rose. Fix each: ${fix}.`, ...rises.flatMap((rise) => riseLines(rise, sites))].join("\n"));
		writeFileSync(baselineFile, `${JSON.stringify(sorted(findings), null, "\t")}\n`);
		return;
	}
	if (recorded === undefined) throw new Error(`${baselineFile} doesn't exist. Write it with ${command}`);
	const falls = differences(findings, recorded, false);
	if (rises.length === 0 && falls.length === 0) return;
	throw new Error(
		[
			...(rises.length > 0 ? [`These counts rose above ${baselineFile}. Fix each: ${fix}.`, ...rises.flatMap((rise) => riseLines(rise, sites))] : []),
			...(falls.length > 0 ? [`These counts fell below ${baselineFile}. Write the lower counts with ${command}`, ...falls.map(differenceLine)] : []),
		].join("\n"),
	);
}

/** Findings counted by file, from each finding's file and name. */
export function countFindings(found: readonly TFound[]): TFindings {
	const findings: TFindings = {};
	for (const { file, finding } of found) {
		const counts = (findings[file] ??= {});
		counts[finding] = (counts[finding] ?? 0) + 1;
	}
	return findings;
}

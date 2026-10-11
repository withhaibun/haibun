/**
 * Findings held to a baseline file that only shrinks. The file records how many of each finding each file holds. A count
 * above its record fails and names the finding to fix. A count below its record fails as well and names the command that
 * writes the lower counts, so the file holds each gain. The command doesn't write the file where a count exceeds its record.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Findings by the file that holds them, each finding with its count. */
export type TFindings = Record<string, Record<string, number>>;
/** One finding in a file, at the line it starts on where it has one. */
export type TFound = { file: string; finding: string; line?: number };
/** The environment variable that sets a baseline test to write its baseline with the findings that remain. */
export const LOWER_BASELINE = "HAIBUN_LOWER_BASELINE";

/** The findings a check holds to its baseline: counted already, or each found at its line, which a count that exceeds its
 *  record lists. */
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

/** How a count differs from its record: it exceeds the record, or it is lower than the record. */
type TDirection = "exceeds" | "lower";

/** Each count of `from` that differs from its count in `against` in `direction`. */
function differences(from: TFindings, against: TFindings, direction: TDirection): TDifference[] {
	const files = [...new Set([...Object.keys(from), ...Object.keys(against)])].sort();
	return files.flatMap((file) => {
		const found = from[file] ?? {};
		const recorded = against[file] ?? {};
		return [...new Set([...Object.keys(found), ...Object.keys(recorded)])]
			.sort()
			.map((finding) => ({ file, finding, found: found[finding] ?? 0, recorded: recorded[finding] ?? 0 }))
			.filter(({ found, recorded }) => (direction === "exceeds" ? found > recorded : found < recorded));
	});
}

const differenceLine = ({ file, finding, found, recorded }: TDifference): string => `  ${file}: ${finding} ${recorded} -> ${found}`;
/** A count that exceeds its record, and the line of each finding of its kind in its file. */
const exceedingLines = (over: TDifference, sites: readonly TFound[]): string[] => [
	differenceLine(over),
	...sites.filter(({ file, finding, line }) => file === over.file && finding === over.finding && line !== undefined).map(({ file, line }) => `    ${file}:${line}`),
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

/** Fails where the findings differ from the baseline file. With the environment variable set, writes the file instead, unless a count exceeds its record. */
export function expectWithinBaseline(check: TBaselineCheck): void {
	const { baselineFile, testFile, fix } = check;
	const sites = "found" in check ? check.found : [];
	const findings = "found" in check ? countFindings(check.found) : check.findings;
	const command = lowerCommand(testFile);
	const recorded = existsSync(baselineFile) ? readBaseline(baselineFile) : undefined;
	const exceeding = recorded === undefined ? [] : differences(findings, recorded, "exceeds");
	if (process.env[LOWER_BASELINE] === "true") {
		if (exceeding.length > 0)
			throw new Error(
				[`${command} writes only lower counts, and these exceed their records. Fix each: ${fix}.`, ...exceeding.flatMap((over) => exceedingLines(over, sites))].join("\n"),
			);
		writeFileSync(baselineFile, `${JSON.stringify(sorted(findings), null, "\t")}\n`);
		return;
	}
	if (recorded === undefined) throw new Error(`${baselineFile} doesn't exist. Write it with ${command}`);
	const lower = differences(findings, recorded, "lower");
	if (exceeding.length === 0 && lower.length === 0) return;
	throw new Error(
		[
			...(exceeding.length > 0 ? [`These counts exceed what ${baselineFile} records. Fix each: ${fix}.`, ...exceeding.flatMap((over) => exceedingLines(over, sites))] : []),
			...(lower.length > 0 ? [`These counts are lower than what ${baselineFile} records. Write the lower counts with ${command}`, ...lower.map(differenceLine)] : []),
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

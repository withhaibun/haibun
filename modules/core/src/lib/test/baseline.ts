/**
 * Findings held to a baseline file that only shrinks. The file records how many of each finding each file holds. A count
 * above its record fails and names the finding to fix. The file is a file snapshot of the counts, so a count below its record
 * fails as a snapshot does, and `vitest run -u` writes the lower counts, so the file holds each gain. A count above its record
 * fails before the snapshot is compared, so an update doesn't raise a record.
 */
import { existsSync, readFileSync } from "node:fs";
import { expect } from "vitest";

/** Findings by the file that holds them, each finding with its count. */
export type TFindings = Record<string, Record<string, number>>;
/** One finding in a file, at the line it starts on where it has one. */
export type TFound = { file: string; finding: string; line?: number };

/** How long a rule test that reads every source of the repository may take: a read of thousands of files, longer under a
 *  parallel run than a unit test's default. */
export const REPOSITORY_SCAN_MS = 30_000;

/** The findings a check holds to its baseline: counted already, or each found at its line, which a count that exceeds its
 *  record lists. */
type TBaselineCheck = {
	/** The JSON file that records the findings. */
	baselineFile: string;
	/** The test file by its path from the repository root, which an update runs. */
	testFile: string;
	/** What removes a finding the record doesn't hold. */
	fix: string;
} & ({ findings: TFindings } | { found: readonly TFound[] });
type TDifference = { file: string; finding: string; found: number; recorded: number };

/** The command that writes a test's baseline with the findings that remain. */
export const lowerCommand = (testFile: string): string => `npx vitest run -u ${testFile}`;

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

/** Fails where a count exceeds its record in the baseline file, and otherwise holds the file as a file snapshot of the counts: a lower
 *  count fails as a snapshot that differs does, until an update writes it, and an update writes a baseline that doesn't exist. */
export async function expectWithinBaseline(check: TBaselineCheck): Promise<void> {
	const { baselineFile, testFile, fix } = check;
	const sites = "found" in check ? check.found : [];
	const findings = "found" in check ? countFindings(check.found) : check.findings;
	const exceeding = existsSync(baselineFile) ? differences(findings, readBaseline(baselineFile), "exceeds") : [];
	if (exceeding.length > 0)
		throw new Error([`These counts exceed what ${baselineFile} records. Fix each: ${fix}.`, ...exceeding.flatMap((over) => exceedingLines(over, sites))].join("\n"));
	await expect(
		`${JSON.stringify(sorted(findings), null, "\t")}\n`,
		`the counts are lower than ${baselineFile} records: write them with ${lowerCommand(testFile)}`,
	).toMatchFileSnapshot(baselineFile);
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

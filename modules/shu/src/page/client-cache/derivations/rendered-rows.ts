/**
 * A row of actuality as a view renders it: a step carries how it went and how long it took, what was logged carries its
 * own level, and what a step produced carries the step that produced it.
 */
import { stepLine } from "@haibun/core/lib/seq-path.js";
import { declaredName, declaresFeature, declaresScenario } from "@haibun/core/lib/domains/protocol.js";
import type { TEventRecord } from "../ports.js";
import type { TActualityRow } from "./actuality-rows.js";

/** What a step declared, where it declared one: a feature or a scenario is the step that named it, and a view titles it
 *  by the name that step carries rather than by a second announcement of the same thing. */
function declared(row: TActualityRow): Record<string, unknown> {
	if (declaresFeature(row.called)) return { type: "feature", featureName: declaredName(row.text, "feature") };
	if (declaresScenario(row.called)) return { type: "scenario", scenarioName: declaredName(row.text, "scenario") };
	return { type: "step" };
}

/** Which record a rendered row is: its type and its own name. A row shows a step's path, and what was logged under a step
 *  shows that step's, so without this a row of what an actuality logged reads as the step it was logged during, and a reader
 *  pressing it doesn't have a record to open. */
const recordOf = (row: TActualityRow): { persistedAs: string; id: string } => ({ persistedAs: row.label, id: row.id });

/** A row as a view renders it. A step carries how it went and how long it took; what was logged carries its own level. */
export function asRendered(row: TActualityRow): TEventRecord {
	// The step path a view shows and navigates by is the path within the execution: the execution separates the records
	// of different actualities, and a reader of one actuality isn't shown it on every row.
	const seqPath = row.under.length ? row.under : undefined;
	if (row.kind === "said") return { id: row.step, kind: "log", level: row.level, message: row.text, timestamp: row.at, seqPath, record: recordOf(row) };
	// A produced thing is claimed by the step it came from, which a document reads from the identity it carries.
	if (row.kind === "produced") return producedRecord(row);
	return stepRecord(row, seqPath);
}

/** What a step produced, as a view renders it. */
function producedRecord(row: TActualityRow): TEventRecord {
	const seqPath = row.under?.length ? row.under : undefined;
	return {
		id: row.id,
		kind: "artifact",
		artifactType: row.artifactType,
		level: row.level,
		timestamp: row.at,
		...(row.path === undefined ? {} : { path: row.path }),
		...(row.featureRelativePath === undefined ? {} : { featureRelativePath: row.featureRelativePath }),
		...(row.mediaType === undefined ? {} : { mimetype: row.mediaType }),
		...(row.carriedBy === undefined ? {} : { carriedBy: row.carriedBy }),
		seqPath,
		record: recordOf(row),
	};
}

/** A step's own record, as a view renders it, carrying what that step produced. */
function stepRecord(row: TActualityRow, seqPath: number[] | undefined): TEventRecord {
	return {
		id: row.step,
		kind: "lifecycle",
		...declared(row),
		level: row.level,
		// The step's words, and what ran: a view shows the step's own words and states which action carried them out.
		in: row.text,
		...(row.called === undefined ? {} : { called: row.called, actionName: row.called }),
		status: row.status,
		...(row.error === undefined ? {} : { error: row.error }),
		...(row.showed === undefined ? {} : { showed: row.showed }),
		timestamp: row.at,
		...(row.endedAt === undefined ? {} : { endedAt: row.endedAt }),
		// The step's words, outcome, times, dispatch and action, as core reads a step's record.
		line: stepLine(row.record),
		// The step a substep was run to carry out, so a reader shown one reads the step that established it.
		...(row.partOf === undefined ? {} : { partOf: row.partOf }),
		// What this step produced, shown by the row of the step a reader sees rather than by rows of its own.
		...(row.produced === undefined ? {} : { produced: row.produced.map(producedRecord) }),
		seqPath,
		record: recordOf(row),
	};
}

/** Actuality as a view reads it, at one level. `at` moves the window; absent, it follows the newest records. */

/** Returns the instant a rendered row records, which every rendered row states. */
export function renderedAt(event: TEventRecord): number {
	const at = event.timestamp;
	if (typeof at !== "number") throw new Error(`a row of actuality states its instant as ${typeof at}, not a number`);
	return at;
}

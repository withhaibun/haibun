import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";

/** The heads of the logic module's waypoints, which a feature states and each waypoint below declares. */
export const steps = {
	tookLessThan: (line: string, ms: string) => `the step ${line} took less than ${ms} ms`,
	called: (line: string, method: string) => `the step ${line} called ${method}`,
};

/** The statement that reads each record of the feature's steps whose line is `{line}`, with `holds` stated of it. */
const everyRecordOf = (holds: string): string => `every step observed in steps is where variable step/stepText is {line}, ${holds}`;

export const backgrounds: TKirejiExport = {
	"Step records": [
		"Each step a feature's line runs has a record, which states the line, the step it called and how long it took.",
		"Activity: Read how long a step took",
		everyRecordOf("variable step/duration is less than {ms}"),
		`waypoint ${steps.tookLessThan("{line}", "{ms}")}`,
		"Activity: Read the step a line called",
		everyRecordOf("variable step/called is {method}"),
		`waypoint ${steps.called("{line}", "{method}")}`,
	],
};

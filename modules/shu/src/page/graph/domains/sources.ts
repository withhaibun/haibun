/**
 * The source formats a graph view reads its graph as. Each is a step that returns the graph's projection (ProjectionSchema):
 * its text, a summary of its kinds, its lines with the statement and record behind each, and its term graph. A format is data,
 * so a format another stepper projects plugs in as an entry here, and the source pane and the terms choice read it unchanged.
 */
export const SOURCE_FORMATS = [{ id: "tptp", label: "TPTP", step: "GraphSourceStepper-showGraphAsTptp", extension: "p" }] as const;
export type TSourceFormat = (typeof SOURCE_FORMATS)[number];
export const SOURCE_FORMAT_IDS = SOURCE_FORMATS.map(({ id }) => id) as [TSourceFormat["id"], ...TSourceFormat["id"][]];

/** The format `id` names. Throws for an id the catalog doesn't hold, which a persisted choice of a removed format would be. */
export function sourceFormat(id: string): TSourceFormat {
	const format = SOURCE_FORMATS.find((one) => one.id === id);
	if (format === undefined) throw new Error(`the graph doesn't read a source format "${id}"; choose one of ${SOURCE_FORMAT_IDS.join(", ")}`);
	return format;
}

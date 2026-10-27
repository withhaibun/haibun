/**
 * The source formats a graph view reads its graph as. Each is a step that returns the graph's description (DescriptionSchema):
 * its text, a summary of its kinds, and its frames with the statement and record behind each. A format is data, so a format
 * another stepper describes plugs in as an entry here, and the source pane reads it unchanged.
 */
export const SOURCE_FORMATS = [{ id: "manchester", label: "Manchester", step: "GraphSourceStepper-showGraphDescription", extension: "omn" }] as const;
export type TSourceFormat = (typeof SOURCE_FORMATS)[number];
export const SOURCE_FORMAT_IDS = SOURCE_FORMATS.map(({ id }) => id) as [TSourceFormat["id"], ...TSourceFormat["id"][]];

/** The format `id` names. Throws for an id the catalog doesn't hold, which a persisted choice of a removed format would be. */
export function sourceFormat(id: string): TSourceFormat {
	const format = SOURCE_FORMATS.find((one) => one.id === id);
	if (format === undefined) throw new Error(`the graph doesn't read a source format "${id}"; choose one of ${SOURCE_FORMAT_IDS.join(", ")}`);
	return format;
}

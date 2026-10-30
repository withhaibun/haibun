import { z } from "zod";
import { DOMAIN_GRAPH_QUERY, RecordQuerySchema, DOMAIN_DENSITY_QUERY, DensityRequestSchema } from "../steps/domains/quad-types.js";
import { fromJsonText, JsonObjectTextSchema } from "../domains/json-text.js";
import { fieldComparisonSchema } from "../domains/lists.js";
import { DOMAIN_FILE_DATA, DOMAIN_IMAGE_REFERENCE, FileDataSchema, ImageReferenceSchema, recordedFileData } from "../domains/media-object.js";
import { extractSeqPathPrefix, parseSeqPath, seqPathDomainDefinition } from "../actuality/domains/seq-path.js";
import { factDomainDefinition } from "../records/domains/facts.js";
import { variableDomainDefinition } from "../records/domains/variables.js";
import { classDomainDefinition, propertyDomainDefinition } from "../records/domains/ontology.js";
import { DOMAIN_FIELD, DOMAIN_LABEL, DOMAIN_RECORD_DOMAIN, DomainRecordSchema } from "../records/domains/domain-record.js";
import { MEDIA_TYPE } from "../domains/media-types.js";
import { RDFS_DATATYPE } from "../domains/vocabularies.js";
import { Access, DOMAIN_PERSISTED_TYPE, HELD_BY, LinkRelations, type TCoercionSite, type TDomainDefinition } from "../domains/resources.js";
import type { TWorld } from "../actuality/domains/world.js";
import { TStepValue } from "../domains/protocol.js";
import { DOMAIN_INDIVIDUAL_ADDRESS, IndividualAddressSchema } from "../domains/typed-links.js";
import {
	DOMAIN_ACTIONS,
	DOMAIN_DATE,
	DOMAIN_JSON,
	DOMAIN_JSON_OBJECT,
	DOMAIN_LINK,
	DOMAIN_NUMBER,
	DOMAIN_RECORD_ID,
	DOMAIN_STATEMENT,
	DOMAIN_STRING,
	DOMAIN_TEXT,
	DOMAIN_VARIABLE_NAME,
	DOMAIN_DOMAIN_NAME,
	DOMAIN_GLOB,
	DOMAIN_FILE_PATH,
	DOMAIN_ROUTE,
	DOMAIN_BEARER_TOKEN,
	DOMAIN_PERSISTED_TYPES,
	DOMAIN_BACKGROUND_NAMES,
	DOMAIN_STEP_PATH,
	DOMAIN_DURATION,
	DOMAIN_FIELD_COMPARISON,
	DOMAIN_STEP_METHOD,
	DOMAIN_LINK_REL,
	DOMAIN_VARIABLE_VALUE,
	DURATION_TERM,
	DOMAIN_TEMPLATE,
	DOMAIN_WAYPOINT_ARGUMENT,
	DOMAIN_UNIVERSAL,
	UNIVERSAL,
	DOMAIN_LINE_COMMENT,
	DOMAIN_HYPERMEDIA_DECLARATION,
	DOMAIN_SET_VALUES,
	DOMAIN_STATEMENT_LINES,
	listedSchema,
	backgroundNamesSchema,
	setValuesSchema,
	DOMAIN_TITLE,
	deriveNamingDomains,
	mapDefinitionsToDomains,
	recordIdInputSchema,
	NameSchema,
} from "../domains/domains.js";
import { findFeatureStepsFromStatement } from "../actuality/pipelines/resolver.js";
import { lineOfCall } from "../steps/derivations/named-vars.js";

const numberSchema = z.coerce.number({ error: "invalid number" }).refine((value) => Number.isFinite(value), "invalid number");
const stringSchema = z.coerce.string({ error: "value is required" });
const statementSchema = z.string({ error: "statement label is required" }).min(1, "statement cannot be empty");
/** A statement as a call states it: its step's method and the step's parameters. */
const StatementCallSchema = z.object({ method: z.string().min(1), params: z.record(z.string(), z.unknown()) }).strict();

/** The line of a call: its step's pattern with its parameters, each statement a parameter states as a call read as that call's
 *  line, so a call nests the calls of a statement's steps. Refuses a method actuality doesn't register. */
function callLine(world: TWorld, { method, params }: z.infer<typeof StatementCallSchema>): string | { refused: string } {
	const tool = world.runtime.stepRegistry?.get(method);
	if (tool === undefined) return { refused: `"${method}" isn't a step actuality registers; show steps lists the method names actuality registers` };
	const stated: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(params)) {
		const call = tool.paramDomainKeys.get(name) === DOMAIN_STATEMENT ? StatementCallSchema.safeParse(value) : undefined;
		if (call === undefined || !call.success) stated[name] = value;
		else {
			const nested = callLine(world, call.data);
			if (typeof nested !== "string") return nested;
			stated[name] = nested;
		}
	}
	return lineOfCall(tool.descriptor.pattern, stated);
}
const dateSchema = z.coerce.date({ error: "invalid date" });
/** Reads a step's place from its dot-joined sequence path, or from an id that begins with one. */
const stepPathSchema = z.preprocess((value, ctx) => {
	if (typeof value !== "string") return value;
	const prefix = extractSeqPathPrefix(value);
	const path = prefix === null ? null : parseSeqPath(prefix);
	if (path === null) ctx.addIssue({ code: "custom", message: `${JSON.stringify(value)} doesn't name a step: a step's place is dot-joined integers, such as 0.1.5.3` });
	return path ?? value;
}, z.array(z.number().int()).min(1));
/** Reads a length of time in milliseconds from seconds or milliseconds, such as `2s` or `30 ms`, or from a number of milliseconds. */
const durationSchema = z.preprocess((value, ctx) => {
	if (typeof value !== "string") return value;
	const match = DURATION_TERM.exec(value.trim());
	if (!match) ctx.addIssue({ code: "custom", message: `${JSON.stringify(value)} isn't a length of time: give seconds or milliseconds, such as 2s or 30 ms` });
	return match ? Number(match[1]) * (match[2] === "s" ? 1000 : 1) : value;
}, z.number().nonnegative());

/** The Domain type, whose records core derives from the declarations, so the type states `heldBy: declarations`. */
const domainRecordDefinition: TDomainDefinition = {
	selectors: [DOMAIN_RECORD_DOMAIN],
	schema: DomainRecordSchema,
	description: "A registered domain: its key, what it holds, its values where it is a set, the component that draws it where it is a view, and the type it is persisted as.",
	topology: {
		persistedAs: DOMAIN_LABEL,
		type: RDFS_DATATYPE,
		id: DOMAIN_FIELD.name,
		heldBy: HELD_BY.declarations,
		accessLevel: Access.public,
		displayLabel: DOMAIN_FIELD.name,
		properties: {
			[DOMAIN_FIELD.name]: LinkRelations.IDENTIFIER.rel,
			[DOMAIN_FIELD.description]: LinkRelations.DESCRIPTION.rel,
			[DOMAIN_FIELD.values]: LinkRelations.TAG.rel,
			[DOMAIN_FIELD.component]: LinkRelations.TAG.rel,
			[DOMAIN_FIELD.persisted]: LinkRelations.TAG.rel,
			[DOMAIN_FIELD.topology]: { rel: LinkRelations.CONTENT.rel, mediaType: MEDIA_TYPE.json },
			[DOMAIN_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[DOMAIN_FIELD.accessLevel]: LinkRelations.ACCESS_LEVEL.rel,
		},
		// A persisted domain's record names the type it is persisted as, so the record links the type's Class and its records.
		ranges: { [DOMAIN_FIELD.persisted]: DOMAIN_PERSISTED_TYPE },
	},
};

const getCoreDomainDefinitions = (world: TWorld): TDomainDefinition[] => [
	// The types of the records core writes or derives: each step's record, the facts and variables actuality holds, the ontology,
	// and the registered domains.
	seqPathDomainDefinition,
	factDomainDefinition,
	variableDomainDefinition,
	classDomainDefinition,
	propertyDomainDefinition,
	domainRecordDefinition,
	{ selectors: [DOMAIN_STRING], schema: stringSchema, description: "A plain string literal captured from feature text." },
	{ selectors: [DOMAIN_TEXT], schema: stringSchema, description: "Free text a person writes: a note, a question, a reason or a passage quoted, read as written." },
	{
		selectors: [DOMAIN_VARIABLE_NAME],
		schema: NameSchema,
		written: true,
		filled: true,
		description: "The name of a variable, as written in the line. Each {name} in it is replaced by the resolved value of name.",
	},
	{ selectors: [DOMAIN_IMAGE_REFERENCE], schema: ImageReferenceSchema, description: "An image: the location of its bytes in actuality's storage, and their media type." },
	{
		selectors: [DOMAIN_FILE_DATA],
		schema: FileDataSchema,
		recordedAs: recordedFileData,
		description: "A file's bytes as a data: URL, as a page reads a file. A step's record states the file's type and size in place of its bytes.",
	},
	{ selectors: [DOMAIN_DOMAIN_NAME], schema: NameSchema, written: true, description: "The name a declaration gives a new domain, as written in the line." },
	{ selectors: [DOMAIN_GLOB], schema: NameSchema, description: "A pattern in which * matches any sequence of characters." },
	{ selectors: [DOMAIN_FILE_PATH], schema: NameSchema, description: "A file or directory's path, as a storage or the file system reads it." },
	{ selectors: [DOMAIN_TITLE], schema: NameSchema, written: true, description: "The title of a feature, scenario, activity or waypoint, as written in the line." },
	{
		selectors: [DOMAIN_WAYPOINT_ARGUMENT],
		schema: NameSchema,
		description:
			"An argument in a call to a waypoint, for a placeholder in the waypoint's outcome pattern. It is quoted text, or the value of the variable that an unquoted name references. The activity and the proof read it as a runtime argument.",
	},
	{ selectors: [DOMAIN_UNIVERSAL], schema: z.string().regex(UNIVERSAL), written: true, description: "A universal rule, {x: D} where B, H, as written in the line." },
	{
		selectors: [DOMAIN_LINE_COMMENT],
		schema: z.string(),
		written: true,
		description: "The text of a line comment after `;;`, as written in the feature. Actuality doesn't act on it.",
	},
	{ selectors: [DOMAIN_ROUTE], schema: NameSchema, description: "The path at which a web server serves a resource, such as /shu." },
	{ selectors: [DOMAIN_BEARER_TOKEN], schema: NameSchema, description: "A token sent as `Authorization: Bearer` (RFC 6750). It grants its holder the access it carries." },
	{ selectors: [DOMAIN_PERSISTED_TYPES], schema: listedSchema(NameSchema, "type"), description: "The persisted types of records, given as a list or as text separated by commas." },
	{
		selectors: [DOMAIN_BACKGROUND_NAMES],
		schema: backgroundNamesSchema,
		written: true,
		description: "The names of the backgrounds a feature includes, given as a list or as text separated by commas, as written in the line.",
	},
	{
		selectors: [DOMAIN_STEP_PATH],
		schema: stepPathSchema,
		description: "A step's place in actuality: its dot-joined sequence path, such as 0.1.5.3, or an id that begins with one, as an event's does.",
	},
	{ selectors: [DOMAIN_DURATION], schema: durationSchema, description: "A length of time, given as seconds or milliseconds, such as 2s or 30 ms, read as milliseconds." },
	{
		selectors: [DOMAIN_FIELD_COMPARISON],
		schema: fieldComparisonSchema,
		written: true,
		filled: true,
		description: "A comparison of a field's value with a value: matches, is, is more than or is less than, then the value, such as is more than 3.",
	},
	{
		selectors: [DOMAIN_STEP_METHOD],
		schema: z.string().regex(/^[A-Za-z0-9_]+-[A-Za-z0-9_]+$/, "doesn't name a step: a step is named by its stepper and step joined by a hyphen"),
		description: "A step's name in a call: its stepper and step joined by a hyphen, such as Haibun-showSteps.",
	},
	{ selectors: [DOMAIN_LINK_REL], schema: NameSchema, description: "A link relation's name, as a statement's predicate uses it, such as cites." },
	{
		selectors: [DOMAIN_VARIABLE_VALUE],
		schema: z.unknown(),
		description:
			"A value to assign to a variable or to compare with a variable's value. The step receives it as a TStepValue with its domain, and the variable's domain coerces it.",
	},
	{ selectors: [DOMAIN_TEMPLATE], schema: z.string(), written: true, description: "Text as written in the line. A composition fills each #{name} placeholder from a variable." },
	{
		selectors: [DOMAIN_HYPERMEDIA_DECLARATION],
		schema: z.string().trim().min(1, "the declaration is empty"),
		written: true,
		description: "A declared type's hypermedia declaration, as written in the line: its JSON-LD @context, or prose naming its fields.",
	},
	{ selectors: [DOMAIN_SET_VALUES], schema: setValuesSchema, written: true, description: "The members of a bracketed list, as written in the line." },
	{
		selectors: [DOMAIN_STATEMENT_LINES],
		schema: fromJsonText(z.array(z.string().min(1)).min(1)),
		description: "Step lines, in order, as a JSON array: the statements a saved activity runs.",
	},
	{ selectors: [DOMAIN_LINK], schema: stringSchema, description: "A URI string for a navigable link." },
	{
		selectors: [DOMAIN_NUMBER],
		schema: numberSchema,
		description: "A numeric literal coerced with Number().",
		comparator: (value, baseline) => (value as number) - (baseline as number),
	},
	{
		selectors: [DOMAIN_DATE],
		schema: dateSchema,
		description: "A Date object coerced from an ISO timestamp, epoch milliseconds or a Date literal.",
		comparator: (value, baseline) => (value as Date).getTime() - (baseline as Date).getTime(),
	},
	{
		// Core declares this domain once, with RecordQuerySchema, so every step that takes a graph query validates it with one
		// schema. registerDomains keeps the first declaration of a domain key and skips later ones.
		selectors: [DOMAIN_GRAPH_QUERY],
		schema: fromJsonText(RecordQuerySchema),
		description: "A request for records from the graph: the class expression they are members of, in Manchester syntax, with sort order and a result limit.",
	},
	{
		selectors: [DOMAIN_DENSITY_QUERY],
		schema: fromJsonText(DensityRequestSchema),
		description: "A request for the number of records of one type in each division of a span of time, grouped by a field that states each record's outcome.",
	},
	{
		selectors: [DOMAIN_ACTIONS],
		schema: listedSchema(z.string().min(1), "action"),
		description: "The actions a caller holds or a delegation allows, such as `Read:public` or `WebPlaywright:attach`, given as a list or as text separated by commas.",
	},
	{ selectors: [DOMAIN_INDIVIDUAL_ADDRESS], schema: IndividualAddressSchema, description: "An individual, by its persisted type and its id." },
	{ selectors: [DOMAIN_RECORD_ID], schema: recordIdInputSchema, description: "The id of a record, of the type another parameter of the same step names." },
	{ selectors: [DOMAIN_JSON], schema: fromJsonText(z.json()), description: "A JSON value, given as its text or as the value." },
	{ selectors: [DOMAIN_JSON_OBJECT], schema: JsonObjectTextSchema, description: "A JSON object, given as its text or as the object." },
	{
		selectors: [DOMAIN_STATEMENT],
		// A caller over a transport states a statement as a call: the method of its step and the step's parameters, which read as
		// the step's line. A list combinator's caller states the read it lists that way.
		schema: z.union([
			statementSchema,
			StatementCallSchema.transform((call, ctx) => {
				const line = callLine(world, call);
				if (typeof line === "string") return line;
				ctx.addIssue({ code: "custom", message: line.refused });
				return z.NEVER;
			}),
		]),
		written: true,
		description: "A reference to another Haibun statement: its line, or a call of its step by method and parameters.",
		coerce: (proto: TStepValue, site?: TCoercionSite) => {
			if (site === undefined) throw new Error("a statement is coerced at the step it fills, and this coercion doesn't state the seqPath and the steppers of one");
			return findFeatureStepsFromStatement(statementSchema.parse(proto.value), site.steppers, world, site.path, [...site.seqPath, 0]);
		},
	},
];

// Returns the core domains as registered domains, with the naming domains that deriveNamingDomains adds.
export const getCoreDomains = (world: TWorld) => deriveNamingDomains(mapDefinitionsToDomains(getCoreDomainDefinitions(world)));

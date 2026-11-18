/**
 * The records a question concerns: an individual by its type and id, or the members of a type. A page states a question's
 * records without the schemas of a session.
 */
import { z } from "zod";
import { DENOTES, IndividualAddressSchema } from "../../domains/typed-links.js";

/**
 * An individual is named by the type it is persisted as and its own id, the pair every surface names one by, so
 * whoever resolves it reads it directly. A type names its members, narrowed by the conditions given. `kind` separates
 * the two in the words core already names them by, so a surface holding only a type can't state more.
 */
const ContextIndividualSchema = IndividualAddressSchema.extend({ kind: z.literal(DENOTES.individual) });
const ContextTypeSchema = z.object({
	kind: z.literal(DENOTES.type),
	persistedAs: z.string().describe("The type whose members the question concerns."),
	expression: z.string().min(1).optional().describe("The class expression its members are members of, in Manchester syntax."),
});
export const ContextPatternSchema = z.discriminatedUnion("kind", [ContextIndividualSchema, ContextTypeSchema]);
export type TContextIndividual = z.infer<typeof ContextIndividualSchema>;
export type TContextPattern = z.infer<typeof ContextPatternSchema>;
export const ContextQuerySchema = z.array(ContextPatternSchema);

/** The ask is about one individual. */
export const anIndividual = (persistedAs: string, id: string): TContextIndividual => ({ kind: DENOTES.individual, persistedAs, id });

/** The ask is about a type: its members, narrowed by the class expression given, where one is given. */
export const aType = (persistedAs: string, expression?: string): TContextPattern => ({ kind: DENOTES.type, persistedAs, ...(expression === undefined ? {} : { expression }) });

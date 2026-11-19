/**
 * A stored grant and the relations a test's contracts state over it: whether a grant is revoked, the action it allows, two grants
 * that allow one action, and the principal that controls a grant. Each relation's rules read a grant's fields by the IRIs its type
 * declares, as a check states the facts of the records it reads.
 */
import { z } from "zod";
import { Access, GeneratedAtTimeTextSchema, LinkRelations } from "../domains/resources.js";
import { declaredFieldIri } from "../domains/hypermedia.js";
import { RELATION_NAMESPACE, type TRelation } from "../steps/domains/contract.js";

/** A grant's fields: when it was made, the action it allows, when it was revoked, and the principal that controls it. */
export const GrantSchema = z.object({
	id: z.string(),
	generatedAtTime: GeneratedAtTimeTextSchema,
	allowedAction: z.string().optional(),
	revoked: z.string().optional(),
	controller: z.string().optional(),
});

/** The stored type of a grant. */
export const GRANT = {
	schema: GrantSchema,
	topology: {
		persistedAs: "TestGrant",
		accessLevel: Access.private,
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
			allowedAction: LinkRelations.ALLOWED_ACTION.rel,
			revoked: LinkRelations.REVOKED.rel,
			controller: LinkRelations.ATTRIBUTED_TO.rel,
		},
	},
};

/** A grant's field as a rule names it: the IRI its type declares for it. */
const fieldOf = (key: keyof typeof GrantSchema.shape): string => `<${declaredFieldIri(GRANT.topology, key)}>`;
/** The IRI of a relation's predicate. */
const predicateOf = (name: string): string => `<${RELATION_NAMESPACE}${name}>`;

/** A grant that states when it was revoked. */
export const REVOKED_GRANT: TRelation = {
	name: "revoked_grant",
	phrase: "{grant} is revoked",
	rules: `{ ?g ${fieldOf("revoked")} ?at } => { (?g) ${predicateOf("revoked_grant")} true } .`,
};

/** A grant that allows an action. */
export const ALLOWS_ACTION: TRelation = {
	name: "allows_action",
	phrase: "{grant} allows {action}",
	rules: `{ ?g ${fieldOf("allowedAction")} ?a } => { (?g ?a) ${predicateOf("allows_action")} true } .`,
};

/** Two grants that allow one action. */
export const SHARES_ACTION: TRelation = {
	name: "shares_action",
	phrase: "{a} shares an action with {b}",
	rules: `{ ?a ${fieldOf("allowedAction")} ?x . ?b ${fieldOf("allowedAction")} ?x } => { (?a ?b) ${predicateOf("shares_action")} true } .`,
};

/** A grant its principal controls. */
export const CONTROLS_GRANT: TRelation = {
	name: "controls_grant",
	phrase: "{principal} controls {grant}",
	rules: `{ ?g ${fieldOf("controller")} ?p } => { (?p ?g) ${predicateOf("controls_grant")} true } .`,
};

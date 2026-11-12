/**
 * A step's contract: what a call of the step produces, what it states about its parameters and products, what must hold before
 * it, the writes beyond its products, and whether it rests on input from outside actuality. A step that returns products or writes
 * records declares `contract`, and every reader reads its products through `contractProducts`: dispatch, the registry, discovery,
 * the JSON Schema a step exposes, the page's catalogue, the context harvest and the logic module's producer rules. A statement is a
 * term built from consts: a relation declared once, applied to the step's parameters, its products, the call's principal and the
 * fields of record types. The browser imports this module.
 */
import { z } from "zod";
import { DOMAIN_STATEMENT, DomainKeySchema } from "../../domains/domains.js";
import type { TVerdict } from "../../domains/protocol.js";
import type { TRecordName, WRITE_VERB } from "../../records/domains/unit.js";
import { isRead } from "../../domains/actions.js";
import { HAIBUN_NS } from "../../domains/resources.js";

/** The key of the form that names the statement parameter whose products a step returns as its own. */
const OF = "of";

/** The products a step's call returns, in one of three forms: the domain of its products; a map of each product field to its
 *  domain; or `{ of: <statement parameter> }`, for a step that returns the products of the statement it runs, which take the
 *  domain that the statement's last step names. */
export type TContractProducts<D extends string = string> = D | { readonly [OF]: string } | Readonly<Record<string, D>>;

/** A field of a record type: the type's stored label and a key of its schema, so a renamed field fails to compile. */
export type TField = { readonly persistedAs: string; readonly key: string };

/** An edge of a relation that statements name, which a record of any type holds, such as `mentions`. */
export type TRelationChange = { readonly relation: string };
/** A write beyond a step's products: a field of a record type, or an edge of a relation that a record of any type holds. */
export type TChange = TField | TRelationChange;
/** Returns the change of the edges of `relation` from a record of any type. */
export const relationChange = (relation: string): TRelationChange => ({ relation });

/** Returns the field `key` of the record type that `definition` declares. */
export function field<S extends z.ZodObject>(definition: { readonly schema: S; readonly topology: { readonly persistedAs: string } }, key: keyof z.infer<S> & string): TField {
	return { persistedAs: definition.topology.persistedAs, key };
}

/** A relation that statements share, declared once as a named const by the stepper whose rules state it: its name, its phrase,
 *  and the N3 rules that derive it, which are empty where the relation is a recorded fact. The phrase is the sentence of a
 *  statement that holds, such as `{capability} is revoked`, and its placeholders name the relation's places in order, which are
 *  its arity. A negated statement reads as the phrase inside the `didn't` combinator (`NEGATION_GWTA`). */
export type TRelation = { readonly name: string; readonly phrase: string; readonly rules: string };

/** The phrase of the `didn't` combinator, which states the negation of a step's line and of a statement of facts. */
export const NEGATION_GWTA = `didn't {statements:${DOMAIN_STATEMENT}}`;
/** The place of `NEGATION_GWTA` that holds the negated statement. */
export const NEGATED_PLACE = "statements";

/** A derivation of a record's id from the call's values of its arguments, as a named function, whose name the notation states. */
export type TDerivation = (...values: string[]) => string;

/** The record of a type whose id a derivation returns over the call's values of its arguments. */
export type TDerived = { readonly persistedAs: string; readonly derivation: TDerivation; readonly args: readonly TContractArgument[] };

/** What a statement's argument names: a parameter of the step by its name, the call's products, the call's principal, a field, or
 *  the record a derivation names. */
export type TContractArgument = { readonly parameter: string } | { readonly products: true } | { readonly principal: true } | TField | { readonly derived: TDerived };

/** A statement: a relation applied to its arguments, or its negation. */
export type TStatement = { readonly relation: TRelation; readonly args: readonly TContractArgument[]; readonly negated: boolean };

/** Returns the statement that `relation` holds of `args`. */
export const holds = (relation: TRelation, ...args: TContractArgument[]): TStatement => ({ relation, args, negated: false });
/** Returns the statement that `relation` doesn't hold of `args`. */
export const doesntHold = (relation: TRelation, ...args: TContractArgument[]): TStatement => ({ relation, args, negated: true });
/** The argument that names the step's parameter `name`. */
export const parameter = (name: string): TContractArgument => ({ parameter: name });
/** The argument that names the call's products, and the one that names the call's principal. */
export const PRODUCTS: TContractArgument = { products: true };
export const PRINCIPAL: TContractArgument = { principal: true };
/** Returns the argument that names the record of the type `definition` declares whose id `derivation` returns over the call's
 *  values of `args`, which a check reads by its typed CURIE. Throws where the derivation is anonymous. */
export function derived(definition: { readonly topology: { readonly persistedAs: string } }, derivation: TDerivation, ...args: TContractArgument[]): TContractArgument {
	if (derivation.name === "") throw new Error("a derived argument's derivation is anonymous, and its notation names it. Declare the derivation as a named function");
	return { derived: { persistedAs: definition.topology.persistedAs, derivation, args } };
}
/** The principal of a call that actuality makes as itself, which holds every action. */
export const ACTUALITY_PRINCIPAL = "urn:haibun:actuality";

/** The verbs dispatch writes a step's products with: a record the store doesn't hold, or fields merged into what it holds. */
export type TProductsVerb = typeof WRITE_VERB.create | typeof WRITE_VERB.merge;

/** The parts of a step's contract that a read and a write both state. A descriptor's contract names its domains by their keys.
 *  `states` holds over the parameters and the products, and `requires` over recorded facts before the call. `complete` lists
 *  the fields whose records this instance holds in full: a check reads the records an argument names, and the records each
 *  listed edge reaches, and a negated statement over fields the list holds is proved where those records don't derive it.
 *  `assumed` states that the products rest on a model's output or a parser's reading of outside input, so every fact they hold
 *  carries the assumption. */
type TContractParts<D extends string> = {
	readonly products?: TContractProducts<D>;
	readonly assumed?: true;
	readonly states?: readonly TStatement[];
	readonly requires?: readonly TStatement[];
	readonly complete?: readonly TField[];
};

/** The contract of a read: the step reads and doesn't change a record, so it doesn't state `written` or `changes`. A gate
 *  requires a read at the step's `readsAt` level of a read that doesn't state a capability. */
type TReadContract<D extends string> = TContractParts<D> & { readonly read: true; readonly written?: never; readonly changes?: never };

/** The contract of a write. `changes` lists the fields of the writes beyond the products, empty where its only writes are its
 *  products. `written` names the verb dispatch writes the products with, as one record of the stored type of their domain,
 *  once `states` holds over them; a step that declares it doesn't write its products itself. */
type TWriteContract<D extends string> = TContractParts<D> & { readonly read?: never; readonly written?: TProductsVerb; readonly changes?: readonly TChange[] };

/** A step's contract: a read's or a write's. A step is a read only where its contract states `read`, so a step without a
 *  contract, or with a contract that doesn't state `read`, is a write. */
export type TStepContract<D extends string = string> = TReadContract<D> | TWriteContract<D>;

/** A contract as a descriptor carries it: its products, its `requires` and `states` statements as their sentences, `read`
 *  where the step is a read, and `assumed` where its products rest on outside input. A call that requests a read names such a
 *  step, and actuality returns the result of a read over a transport without recording a step. The statement form of the
 *  products has the shape of a map of one field, `of`, which `contractProducts` reads as the statement form. */
export const StepContractSchema = z.object({
	read: z.literal(true).optional(),
	assumed: z.literal(true).optional(),
	products: z.union([DomainKeySchema, z.record(z.string(), DomainKeySchema)]).optional(),
	requires: z.array(z.string().min(1)).optional(),
	states: z.array(z.string().min(1)).optional(),
});
export type TContractSentences = z.infer<typeof StepContractSchema>;
/** A contract as a page's fixture states it: its products, and its statements' sentences, without the domain keys' brand. */
export type TStatedContract = { readonly read?: true; readonly products?: TContractProducts; readonly requires?: readonly string[]; readonly states?: readonly string[] };

/** The heading of each kind of a contract's statements, as a reader reads it: what holds before a call, and what holds after it. */
const CONTRACT_SAID = { requires: "Before the call", states: "After the call" } as const;

/** What a contract states of products that rest on outside input. */
export const ASSUMED_SAID = "Its products rest on outside input, and each fact they hold is assumed.";

/** The lines that state a descriptor's contract: the sentences of what it requires, of what it states, and its assumption. */
export const contractLines = (contract: TContractSentences | undefined): string[] => [
	...(["requires", "states"] as const).flatMap((check) => {
		const sentences = contract?.[check];
		return sentences === undefined ? [] : [`${CONTRACT_SAID[check]}: ${sentences.join("; ")}.`];
	}),
	...(contract?.assumed ? [ASSUMED_SAID] : []),
];

/** A step's description with its contract's sentences, as a control's tooltip and accessible description state it. */
export const describedWithContract = ({ description, contract }: { readonly description: string; readonly contract?: TContractSentences }): string =>
	[description, ...contractLines(contract)].join(" ");

/** The products a contract declares, in the one form it states: the domain, the domain of each field, or the statement
 *  parameter. A step without a contract has an empty form. */
export type TDeclaredProducts<D extends string = string> = { readonly domain?: D; readonly fields?: Readonly<Record<string, D>>; readonly of?: string };

const isStatementProducts = (products: object): products is { readonly [OF]: string } => {
	const keys = Object.keys(products);
	return keys.length === 1 && keys[0] === OF;
};

/** Returns the products the contract of a step or a descriptor declares. */
export function contractProducts<D extends string>({ contract }: { readonly contract?: Pick<TStepContract<D>, "products"> }): TDeclaredProducts<D> {
	const products = contract?.products;
	if (products === undefined) return {};
	if (typeof products === "string") return { domain: products };
	if (isStatementProducts(products)) return { of: products[OF] };
	return { fields: products as Readonly<Record<string, D>> };
}

/** Returns each domain the contract declares its products in: the domain, or the domain of each field. */
export function productDomains(step: { readonly contract?: Pick<TStepContract, "products"> }): string[] {
	const { domain, fields } = contractProducts(step);
	if (domain !== undefined) return [domain];
	return fields === undefined ? [] : Object.values(fields);
}

/** The term an argument renders as: a parameter by its name, the products, the principal, a field as `Type.key`, or a derived
 *  record as `Type:derivation(arguments)`. */
export const argumentTerm = (argument: TContractArgument): string => {
	if ("parameter" in argument) return argument.parameter;
	if ("products" in argument) return "products";
	if ("principal" in argument) return "principal";
	if ("derived" in argument) return `${argument.derived.persistedAs}:${argument.derived.derivation.name}(${argument.derived.args.map(argumentTerm).join(", ")})`;
	return `${argument.persistedAs}.${argument.key}`;
};

/** The namespace of the predicate each relation names. */
export const RELATION_NAMESPACE = "urn:haibun:relation:";
/** The namespace of the term a field names in a statement, by its type's stored label and its key. */
export const FIELD_NAMESPACE = "urn:haibun:field:";

/** Returns the N3 triple a statement asserts, with each argument as `termOf` writes it: the list of its arguments related to true by
 *  the relation's predicate. A negated statement asserts the same triple, which its check proves absent. */
export const statementN3 = ({ relation, args }: TStatement, termOf: (argument: TContractArgument) => string): string =>
	`(${args.map(termOf).join(" ")}) <${RELATION_NAMESPACE}${relation.name}> true .`;

/** Returns a statement in Unicode notation, as the views show it: `name(a, b)`, with `¬` before a negation. */
export const statementNotation = ({ relation, args, negated }: TStatement): string => `${negated ? "¬" : ""}${relation.name}(${args.map(argumentTerm).join(", ")})`;

/** The statements a call is checked against: those that hold before its action, and those that hold over its products. */
export const CONTRACT_CHECK = { requires: "requires", states: "states" } as const;
export type TContractCheck = (typeof CONTRACT_CHECK)[keyof typeof CONTRACT_CHECK];

/** What a check reads a call by: its arguments by parameter name, its principal, and its products once its action returned them.
 *  A check replaces each argument of a statement by the call's value of it. A call actuality makes as itself states
 *  `ACTUALITY_PRINCIPAL`, and a call without a principal or every action doesn't state one. */
export type TContractCall = { readonly parameters: Readonly<Record<string, unknown>>; readonly principal?: string; readonly products?: unknown };

/** A statement's verdict in a call's check: the statement and its sentence, proved, refuted or unknown, and the triple that
 *  determined it. */
export type TStatementVerdict = { readonly statement: TStatement; readonly sentence: string; readonly verdict: TVerdict; readonly decidedBy: string };

/** The statements a check reads and the fields its contract states complete. */
export type TContractChecking = { readonly statements: readonly TStatement[]; readonly complete: readonly TField[] };

/** A call's check: each statement's verdict, and the N3 facts the check read, the call's and those of the records it read. */
export type TContractChecked = { readonly verdicts: readonly TStatementVerdict[]; readonly facts: string };

/** The namespace of the IRI of each check of a contract, and the predicate that relates a check to the formula of the facts it read. */
export const CHECK_NAMESPACE = "urn:haibun:check:";
export const CHECK_READ = `${CHECK_NAMESPACE}read`;
/** The check of the records an assumed step's call wrote, against the fields each one's type states every member has. */
export const ASSUMED_CHECK = "assumed";

/** Returns the relation that a record holds a value of the field `key`, which a type states every member has (`required`). */
export const requiredRelation = (key: string): TRelation => ({
	name: `has_${key}`,
	phrase: `{record} has its ${key}`,
	rules: `{ ?record <${HAIBUN_NS}${key}> ?value } => { (?record) <${RELATION_NAMESPACE}has_${key}> true } .`,
});

/** Returns a check's facts as N3: the check's IRI related by `CHECK_READ` to the formula of the facts it read. */
export const checkN3 = (check: TContractCheck | typeof ASSUMED_CHECK, facts: string): string => `<${CHECK_NAMESPACE}${check}> <${CHECK_READ}> { ${facts} } .`;

/** Returns the statements of a step's contract that a check of `check` reads, empty where the contract doesn't state them, and
 *  the fields the contract states complete. */
export function contractChecking(step: { readonly contract?: TStepContract }, check: TContractCheck): TContractChecking {
	const statements = step.contract?.[check];
	const complete = step.contract?.complete;
	return { statements: statements === undefined ? [] : statements, complete: complete === undefined ? [] : complete };
}

/** The writes the contract of a step in progress allows: the stored label of each type its products are written as, whose
 *  records the step writes whole or in part, and each field `changes` lists. `step` names the step, and `refused` holds each
 *  write a store refused during the step, as `Type.field`, which the step's record lists, and `written` each record a store
 *  wrote, which the check of an assumed step reads. */
export type TStepWrites = {
	readonly step: string;
	readonly products: readonly string[];
	readonly changes: readonly TChange[];
	readonly refused: string[];
	readonly written: TRecordName[];
};

/** Returns the writes a step's contract allows, or undefined for a step on `contracts.baseline.json`: a write that doesn't
 *  declare `changes`, whose writes aren't checked. A read changes only its products, so it is checked as `changes: []`. */
export function stepWrites(step: { readonly contract?: TStepContract }, name: string, persistedAsOf: (domain: string) => string | undefined): TStepWrites | undefined {
	const declared = step.contract?.changes;
	if (declared === undefined && !isRead(step)) return undefined;
	const changes = declared === undefined ? [] : declared;
	return { step: name, products: contractWrites({ contract: { products: step.contract?.products } }, persistedAsOf), changes, refused: [], written: [] };
}

/** Returns each record type a step's call writes: the stored label of each product domain that `persistedAsOf` returns one for,
 *  and the type of each field the contract lists in `changes`. */
export function contractWrites(step: { readonly contract?: TStepContract }, persistedAsOf: (domain: string) => string | undefined): string[] {
	const derived = productDomains(step).flatMap((domain) => {
		const persistedAs = persistedAsOf(domain);
		return persistedAs === undefined ? [] : [persistedAs];
	});
	const changes = step.contract?.changes;
	const listed = changes === undefined ? [] : changes.flatMap((change) => ("persistedAs" in change ? [change.persistedAs] : []));
	return [...new Set([...derived, ...listed])];
}

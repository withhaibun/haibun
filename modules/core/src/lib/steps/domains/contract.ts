/**
 * A step's contract: what a call of the step produces, what it states about its parameters and products, what must hold before
 * it, the writes beyond its products, and whether it rests on input from outside actuality. A step that returns products or writes
 * records declares `contract`, and every reader reads its products through `contractProducts`: dispatch, the registry, discovery,
 * the JSON Schema a step exposes, the page's catalogue, the context harvest and the logic module's producer rules. A statement is a
 * term built from consts: a relation declared once, applied to the step's parameters, its products, the call's principal and the
 * fields of record types. The browser imports this module.
 */
import { z } from "zod";
import { DomainKeySchema } from "../../domains/domains.js";

/** The key of the form that names the statement parameter whose products a step returns as its own. */
const OF = "of";

/** The products a step's call returns, in one of three forms: the domain of its products; a map of each product field to its
 *  domain; or `{ of: <statement parameter> }`, for a step that returns the products of the statement it runs, which take the
 *  domain that the statement's last step names. */
export type TContractProducts<D extends string = string> = D | { readonly [OF]: string } | Readonly<Record<string, D>>;

/** A field of a record type: the type's stored label and a key of its schema, so a renamed field fails to compile. */
export type TField = { readonly persistedAs: string; readonly key: string };

/** Returns the field `key` of the record type that `definition` declares. */
export function field<S extends z.ZodObject>(definition: { readonly schema: S; readonly topology: { readonly persistedAs: string } }, key: keyof z.infer<S> & string): TField {
	return { persistedAs: definition.topology.persistedAs, key };
}

/** A relation that statements share, declared once as a named const by the stepper whose rules state it: its name, and the N3
 *  rules that derive it, which are empty where the relation is a recorded fact. */
export type TRelation = { readonly name: string; readonly arity: number; readonly rules: string };

/** What a statement's argument names: a parameter of the step by its name, the call's products, the call's principal, or a field. */
export type TContractArgument = { readonly parameter: string } | { readonly products: true } | { readonly principal: true } | TField;

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

/** A step's contract. A descriptor's contract names its domains by their keys. `states` holds over the parameters and the
 *  products, `requires` over recorded facts before the call, `changes` lists the fields of the writes beyond the products, and
 *  `assumed` marks products that rest on input from outside actuality. A step that writes declares `changes`, empty where its only
 *  writes are its products. */
export type TStepContract<D extends string = string> = {
	readonly products?: TContractProducts<D>;
	readonly states?: readonly TStatement[];
	readonly requires?: readonly TStatement[];
	readonly changes?: readonly TField[];
	readonly assumed?: boolean;
};

/** A contract as a descriptor carries it. The statement form has the shape of a map of one field, `of`, which
 *  `contractProducts` reads as the statement form. */
export const StepContractSchema = z.object({ products: z.union([DomainKeySchema, z.record(z.string(), DomainKeySchema)]).optional() });

/** The products a contract declares, in the one form it states: the domain, the domain of each field, or the statement
 *  parameter. A step without a contract has an empty form. */
export type TDeclaredProducts<D extends string = string> = { readonly domain?: D; readonly fields?: Readonly<Record<string, D>>; readonly of?: string };

const isStatementProducts = (products: object): products is { readonly [OF]: string } => {
	const keys = Object.keys(products);
	return keys.length === 1 && keys[0] === OF;
};

/** Returns the products the contract of a step or a descriptor declares. */
export function contractProducts<D extends string>({ contract }: { readonly contract?: TStepContract<D> }): TDeclaredProducts<D> {
	const products = contract?.products;
	if (products === undefined) return {};
	if (typeof products === "string") return { domain: products };
	if (isStatementProducts(products)) return { of: products[OF] };
	return { fields: products as Readonly<Record<string, D>> };
}

/** Returns each domain the contract declares its products in: the domain, or the domain of each field. */
export function productDomains(step: { readonly contract?: TStepContract }): string[] {
	const { domain, fields } = contractProducts(step);
	if (domain !== undefined) return [domain];
	return fields === undefined ? [] : Object.values(fields);
}

/** The text an argument renders as: a parameter by its name in braces, the products, the principal, or a field as `Type.key`. */
const argumentText = (argument: TContractArgument): string => {
	if ("parameter" in argument) return `{${argument.parameter}}`;
	if ("products" in argument) return "products";
	if ("principal" in argument) return "principal";
	return `${argument.persistedAs}.${argument.key}`;
};

/** The namespace of the predicate each relation names. */
export const RELATION_NAMESPACE = "urn:haibun:relation:";

/** Returns the N3 triple a statement asserts, with each argument as `termOf` writes it: the list of its arguments related to true by
 *  the relation's predicate. A negated statement asserts the same triple, which its check proves absent. */
export const statementN3 = ({ relation, args }: TStatement, termOf: (argument: TContractArgument) => string): string =>
	`(${args.map(termOf).join(" ")}) <${RELATION_NAMESPACE}${relation.name}> true .`;

/** Returns a statement in Unicode notation, as the views show it: `name(a, b)`, with `¬` before a negation. */
export const statementNotation = ({ relation, args, negated }: TStatement): string => `${negated ? "¬" : ""}${relation.name}(${args.map(argumentText).join(", ")})`;

/** The writes the contract of a step in progress allows: the stored label of each type its products are written as, whose
 *  records the step writes whole or in part, and each field `changes` lists. `step` names the step. */
export type TStepWrites = { readonly step: string; readonly products: readonly string[]; readonly changes: readonly TField[] };

/** Returns the writes a step's contract allows, or undefined where the contract doesn't declare `changes`. A step that doesn't
 *  declare `changes` is one that `contracts.baseline.json` records, and its writes aren't checked. */
export function stepWrites(step: { readonly contract?: TStepContract }, name: string, persistedAsOf: (domain: string) => string | undefined): TStepWrites | undefined {
	const changes = step.contract?.changes;
	if (changes === undefined) return undefined;
	return { step: name, products: contractWrites({ contract: { products: step.contract?.products } }, persistedAsOf), changes };
}

/** Returns each record type a step's call writes: the stored label of each product domain that `persistedAsOf` returns one for,
 *  and the type of each field the contract lists in `changes`. */
export function contractWrites(step: { readonly contract?: TStepContract }, persistedAsOf: (domain: string) => string | undefined): string[] {
	const derived = productDomains(step).flatMap((domain) => {
		const persistedAs = persistedAsOf(domain);
		return persistedAs === undefined ? [] : [persistedAs];
	});
	const changes = step.contract?.changes;
	const listed = changes === undefined ? [] : changes.map(({ persistedAs }) => persistedAs);
	return [...new Set([...derived, ...listed])];
}

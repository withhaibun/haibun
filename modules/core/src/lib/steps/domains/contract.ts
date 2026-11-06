/**
 * A step's contract: what a call of the step produces. A step that returns products declares `contract`, and every reader
 * reads its products through `contractProducts`: dispatch, the registry, discovery, the JSON Schema a step exposes, the
 * page's catalogue, the context harvest and the logic module's producer rules. The browser imports this module.
 */
import { z } from "zod";
import { DomainKeySchema } from "../../domains/domains.js";

/** The key of the form that names the statement parameter whose products a step returns as its own. */
const OF = "of";

/** The products a step's call returns, in one of three forms: the domain of its products; a map of each product field to its
 *  domain; or `{ of: <statement parameter> }`, for a step that returns the products of the statement it runs, which take the
 *  domain that the statement's last step names. */
export type TContractProducts<D extends string = string> = D | { readonly [OF]: string } | Readonly<Record<string, D>>;

/** A step's contract. A descriptor's contract names its domains by their keys. */
export type TStepContract<D extends string = string> = { readonly products: TContractProducts<D> };

/** A contract as a descriptor carries it. The statement form has the shape of a map of one field, `of`, which
 *  `contractProducts` reads as the statement form. */
export const StepContractSchema = z.object({ products: z.union([DomainKeySchema, z.record(z.string(), DomainKeySchema)]) });

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

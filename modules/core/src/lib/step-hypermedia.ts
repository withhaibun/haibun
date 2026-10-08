import { z } from "zod";
import { jsonSchemaOf } from "./json-schema-of.js";
import { AStepper, type TStepperStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import type { TActionResult } from "../schema/protocol.js";
import { HYPERMEDIA } from "../schema/protocol.js";
import { namedInterpolation } from "./namedVars.js";
import { constructorName } from "./util/index.js";
import { normalizeDomainKey } from "./domains.js";

/**
 * Adds hypermedia markers to a step's products. Every step with a `productsDomain` receives them. The registered
 * domain's declaration supplies their values, and the registered steps supply `_links`. Actions don't emit `_type` or
 * `_summary`.
 *
 * - `_type` is the domain's `ui.component` where the domain declares one, else the domain key.
 * - `_summary` is `ui.summary` where it is a string, or its result where it is a function of the products. Without
 *   `ui.summary` it is the domain key.
 * - `_description` is the domain's description, where it declares one.
 * - `_component`, `id` and `view` are added only for a domain with `ui.component`. The SPA's pane opener reads them, and
 *   a diagnostic or data-only domain doesn't open a pane.
 * - `_links` lists the steps that take the product's domain, where at least one does.
 *
 * Products that already carry a `_component` string are returned unchanged, so a step that sets its own keeps it.
 */
export function augmentViewHypermedia(world: TWorld, step: TStepperStep, actionResult: TActionResult, steppers: AStepper[]): TActionResult {
	if (!actionResult.ok || !actionResult.products) return actionResult;
	const productsDomain = step.productsDomain;
	if (!productsDomain) return actionResult;
	const products = actionResult.products;
	if (typeof products[HYPERMEDIA.COMPONENT] === "string") return actionResult;
	const domain = world.domains[normalizeDomainKey(productsDomain)];
	const ui = domain?.ui;
	const component = typeof ui?.component === "string" ? ui.component : undefined;
	const rawSummary = ui?.summary;
	let summary: string;
	if (typeof rawSummary === "function") summary = String((rawSummary as (p: Record<string, unknown>) => unknown)(products));
	else if (typeof rawSummary === "string") summary = rawSummary;
	else summary = productsDomain;
	const markers: Record<string, unknown> = { [HYPERMEDIA.TYPE]: component ?? productsDomain, [HYPERMEDIA.SUMMARY]: summary };
	// The products domain's description, added to the products so a person, a model or an agent can interpret the result
	// without calling show steps. buildConcernCatalog reads the same field for the type's view. A domain has one
	// description, and a second description on its schema could differ from the one a reader is shown.
	if (domain?.description) markers[HYPERMEDIA.DESCRIPTION] = domain.description;
	if (component) {
		markers[HYPERMEDIA.COMPONENT] = component;
		markers.id = productsDomain;
		markers.view = productsDomain;
	}
	// Next-action affordances: every step whose parameter domains take this product's domain. The SPA row menu, a model or an agent reads `_links` to find follow-on steps without calling show steps. Each entry has the `{method, params?}` shape of every other `_links` entry. Each rel is the step name without its stepper prefix, so it names the action rather than the method address.
	const links = deriveActionLinks(productsDomain, products, steppers, world);
	if (Object.keys(links).length > 0) markers[HYPERMEDIA.LINKS] = links;
	return { ...actionResult, products: { ...products, ...markers } };
}

/**
 * Returns a `_links` map of the steps whose gwta parameter domains take the product's domain. Each matching step has one
 * entry, keyed by its step name without the stepper prefix, so the entry names the action rather than the method address.
 *
 * A parameter matches in one of two ways:
 *   1. Direct: the parameter's domain is the product's domain.
 *   2. Reference: the parameter's domain is a ref domain whose `topology.ranges.id` names the product's domain.
 *      `individualRefDomain(refKey, targetKey)` declares this range for a reference to a targetKey individual. The
 *      derivation follows the range, so a product links each step that takes a reference to it. Revoke, suspend and
 *      recover take a reference to the individual that issue produces.
 *
 * The params skeleton: each matching parameter receives `{ id: <product.id> }` where the product has a top-level string
 * `id`. Every individual ref domain takes this shape, as in `{record: {id}}` and in `{label, id}` for getIndividual.
 * Otherwise the entry omits `params`, and the consumer fills them from the step's inputSchema, which show steps returns.
 *
 * H1: one derivation serves every step, and a step doesn't declare its own links.
 */
function deriveActionLinks(
	productsDomain: string,
	products: Record<string, unknown>,
	steppers: AStepper[],
	world: TWorld,
): Record<string, { method: string; params?: Record<string, unknown> }> {
	const out: Record<string, { method: string; params?: Record<string, unknown> }> = {};
	const productId = typeof products.id === "string" ? products.id : undefined;
	const matchesProduct = (paramDomain: string): boolean => {
		if (paramDomain === productsDomain) return true;
		// A gwta parameter can declare a union domain, such as a page target. A union domain doesn't declare a single-domain topology, so it doesn't match. normalizeDomainKey throws on a misordered union, and the catch returns false, so one such parameter doesn't stop link derivation for every product.
		let refDomain: { topology?: { ranges?: { id?: string } } } | undefined;
		try {
			refDomain = world.domains?.[normalizeDomainKey(paramDomain)];
		} catch {
			return false;
		}
		const ranges = refDomain?.topology && "ranges" in refDomain.topology ? refDomain.topology.ranges : undefined;
		return ranges?.id === productsDomain;
	};
	for (const stepper of steppers) {
		const stepperName = constructorName(stepper);
		for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
			if (!stepDef.gwta) continue;
			const { stepValuesMap } = namedInterpolation(stepDef.gwta);
			if (!stepValuesMap) continue;
			const matching: string[] = [];
			for (const v of Object.values(stepValuesMap)) {
				if (v.domain && matchesProduct(v.domain)) matching.push(v.term);
			}
			if (matching.length === 0) continue;
			const method = `${stepperName}-${stepName}`;
			const params: Record<string, unknown> = {};
			if (productId !== undefined) {
				for (const paramName of matching) params[paramName] = { id: productId };
			}
			out[stepName] = Object.keys(params).length > 0 ? { method, params } : { method };
		}
	}
	return out;
}

/**
 * Whether a domain only renders a view. Such a domain's schema is empty, and its `ui.component` names the pane to open.
 * It doesn't carry data for another step to take. Asserting its products as a fact creates a loop. Each affordances
 * refresh reads the asserted view and includes it in the snapshot, and the SPA opens the pane again, so the panes
 * accumulate.
 *
 * A domain is view-only if and only if it declares `ui.component` and its registered schema is an object without fields.
 * DOMAIN_AFFORDANCES and DOMAIN_CHAIN_LINT declare a view, and their schemas have fields. They carry data, and their
 * products are asserted.
 */
export function isViewOnlyDomain(world: TWorld, domainKey: string): boolean {
	const domain = world.domains[normalizeDomainKey(domainKey)];
	if (!domain?.ui?.component || typeof domain.ui.component !== "string") return false;
	// z.coerce.date doesn't have a JSON Schema form. `unrepresentable: "any"` lets the check read a schema with a date field, since the check reads only whether the schema has fields.
	const jsonSchema = jsonSchemaOf(domain.schema, "fields", () => z.toJSONSchema(domain.schema, { unrepresentable: "any" })) as {
		properties?: Record<string, unknown>;
		type?: string;
	};
	if (jsonSchema.type !== "object") return false;
	return !jsonSchema.properties || Object.keys(jsonSchema.properties).length === 0;
}

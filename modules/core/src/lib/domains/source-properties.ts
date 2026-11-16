/**
 * Reading and checking a source domain's declared property: the copy that respects its byte ceiling, and the in-place
 * evaluation a comparison step takes when the property states the operator without carrying the value.
 */
import type { TPropertyOperator, TPropertyVerdict, TSourceProperty } from "./resources.js";
import { normalizeDomainKey } from "./domains.js";
import type { TWorld } from "../actuality/domains/world.js";

export type { TPropertyOperator, TPropertyVerdict } from "./resources.js";

/** The readable property a path into a domain's value takes, or undefined where the domain doesn't declare one. */
export function sourcePropertyOf(domains: Record<string, unknown>, domainName: string | undefined, property: string | undefined): TSourceProperty | undefined {
	if (domainName === undefined || property === undefined) return undefined;
	const domain = domains[normalizeDomainKey(domainName)] as { properties?: Record<string, TSourceProperty> } | undefined;
	return domain?.properties?.[property];
}

function byteLength(value: unknown): number {
	return typeof value === "string" ? new TextEncoder().encode(value).length : JSON.stringify(value ?? null).length;
}

/** Reads a source property within its byte ceiling. Throws naming the ceiling where the value holds more, so a step
 *  that would carry it refuses instead of copying. */
export async function readSourceProperty(world: TWorld, subject: unknown, property: TSourceProperty, subpath?: readonly string[]): Promise<unknown> {
	const value = await property.read(subject, world, subpath);
	const bytes = byteLength(value);
	if (bytes > property.maxBytes)
		throw new Error(`the value holds ${bytes} bytes, over the ${property.maxBytes} its property allows to Node; check it in place with a comparison, or read a smaller part of it`);
	return value;
}

/** Evaluates a comparison of a source property in place, where the property states the operator; undefined where it
 *  doesn't, so the caller reads the value and compares it. */
export async function evaluateSourceProperty(
	world: TWorld,
	subject: unknown,
	property: TSourceProperty | undefined,
	operator: TPropertyOperator,
	expected: unknown,
	subpath?: readonly string[],
): Promise<TPropertyVerdict | undefined> {
	if (property?.evaluate === undefined) return undefined;
	return await property.evaluate(subject, operator, expected, world, subpath);
}

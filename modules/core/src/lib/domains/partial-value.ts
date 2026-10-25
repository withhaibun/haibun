/**
 * Compares a value against an expected partial value, as `producing` compares a statement's products: each key of an expected
 * object is in the value and holds what it expects, each item of an expected list is the item at its place in a list of the
 * same length, and an expected string is a pattern whose `*` matches any characters, as `matches` reads one.
 */
import { globSource } from "./domains.js";

/** The text a pattern is matched against: a string as it is, and any other value as its JSON. */
const textOf = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Where `actual` doesn't hold `expected`, the path to the first difference under `at` and what differs; undefined where it holds. */
export function partialDifference(expected: unknown, actual: unknown, at: string): string | undefined {
	if (typeof expected === "string")
		return new RegExp(globSource(expected), "s").test(textOf(actual)) ? undefined : `${at} is ${JSON.stringify(actual)}, which doesn't match "${expected}"`;
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual) || actual.length !== expected.length) return `${at} is ${JSON.stringify(actual)}, not a list of ${expected.length} items`;
		for (const [index, item] of expected.entries()) {
			const differs = partialDifference(item, actual[index], `${at}[${index}]`);
			if (differs !== undefined) return differs;
		}
		return undefined;
	}
	if (isObject(expected)) {
		if (!isObject(actual)) return `${at} is ${JSON.stringify(actual)}, not an object`;
		for (const [key, value] of Object.entries(expected)) {
			if (!(key in actual)) return `${at} holds ${JSON.stringify(Object.keys(actual))}, without ${key}`;
			const differs = partialDifference(value, actual[key], `${at}.${key}`);
			if (differs !== undefined) return differs;
		}
		return undefined;
	}
	return Object.is(expected, actual) ? undefined : `${at} is ${JSON.stringify(actual)}, not ${JSON.stringify(expected)}`;
}

import { z } from "zod";
import type { TDomainDefinition, TRegisteredDomain } from "./resources.js";
import type { TWorld } from "./execution.js";

export const DOMAIN_STATEMENT = "statement";
export const DOMAIN_STRING = "string";
export const DOMAIN_LINK = "link";
export const DOMAIN_NUMBER = "number";
export const DOMAIN_JSON = "json";
export const DOMAIN_DATE = "date";
export const BASE_TYPES = [DOMAIN_STRING, DOMAIN_LINK, DOMAIN_NUMBER, DOMAIN_DATE, DOMAIN_STATEMENT, DOMAIN_JSON];

export type TEnumDomainInput = {
	name: string;
	values: string[];
	description?: string;
	ordered?: boolean;
};

export const registerDomains = (world: TWorld, results: TDomainDefinition[][]) => {
	for (const stepperWithDomains of results) {
		for (const definition of stepperWithDomains) {
			const domainKey = asDomainKey(definition.selectors);

			if (world.domains[domainKey]) continue;

			world.domains[domainKey] = toRegisteredDomain(definition);
		}
	}
};

export const asDomainKey = (domains: string[]) => domains?.sort().join(" | ");

export const normalizeDomainKey = (domain: string) => {
	// Split on ' | ' (union separator), not on '/' which is used in variable names
	const parts = domain
		?.split(" | ")
		.map((selector) => selector.trim())
		.filter(Boolean);
	const normalized = asDomainKey(parts);
	if (domain !== normalized) {
		throw Error(`domain key "${domain}", expected "${normalized}"`);
	}
	return normalized;
};

const sanitizeToken = (value: string) => value.trim();

const normalizeEnumValues = (domainName: string, values: string[], requireMultiple = false) => {
	const cleaned = values.map(sanitizeToken).filter(Boolean);
	if (cleaned.length === 0) {
		throw new Error(`Domain "${domainName}" must declare at least one value`);
	}
	if (requireMultiple && cleaned.length < 2) {
		throw new Error(`Domain "${domainName}" must declare at least two values`);
	}
	const unique: string[] = [];
	for (const value of cleaned) {
		if (unique.includes(value)) {
			throw new Error(`Domain "${domainName}" has duplicate value "${value}"`);
		}
		unique.push(value);
	}
	return unique;
};

export const createEnumDomainDefinition = ({ name, values, description, ordered = false }: TEnumDomainInput): TDomainDefinition => {
	const domainName = sanitizeToken(name);
	if (!domainName) {
		throw new Error("Domain name must be provided");
	}
	const uniqueValues = normalizeEnumValues(domainName, values, ordered);
	const descriptor = description ?? `${domainName} values: ${uniqueValues.join(", ")}`;
	const schema = z.enum(uniqueValues as [string, ...string[]]).describe(descriptor);
	return {
		selectors: [domainName],
		schema,
		comparator: ordered
			? (value, baseline) => uniqueValues.indexOf(value as string) - uniqueValues.indexOf(baseline as string)
			: undefined,
		values: uniqueValues,
		description: descriptor,
	};
};

export const toRegisteredDomain = (definition: TDomainDefinition): TRegisteredDomain => ({
	selectors: [...definition.selectors],
	schema: definition.schema,
	coerce: definition.coerce ?? ((proto) => definition.schema.parse(proto.value)),
	comparator: definition.comparator,
	values: definition.values,
	description: definition.description,
	stepperName: definition.stepperName,
	topology: definition.topology,
});

export const mapDefinitionsToDomains = (definitions: TDomainDefinition[]) => {
	return definitions.reduce<Record<string, TRegisteredDomain>>((acc, definition) => {
		const domainKey = asDomainKey(definition.selectors);
		acc[domainKey] = toRegisteredDomain(definition);
		return acc;
	}, {});
};

/** Coercer: JSON-parses strings, validates with schema. Used by haibun domain coercion for object-typed params. */
export function objectCoercer<T extends z.ZodType>(schema: T) {
	return (proto: { value?: unknown }) => {
		const value = typeof proto.value === "string" ? JSON.parse(proto.value) : proto.value;
		return schema.parse(value);
	};
}

/** Build a Map from vertexLabel → TRegisteredDomain for all vertex domains. */
export function vertexDomainMap(domains: Record<string, TRegisteredDomain>): Map<string, TRegisteredDomain> {
	const map = new Map<string, TRegisteredDomain>();
	for (const domain of Object.values(domains)) {
		if (domain.topology?.vertexLabel) map.set(domain.topology.vertexLabel, domain);
	}
	return map;
}

/** Get all vertex domains (domains with topology.vertexLabel) as an array. */
export function getVertexDomains(domains: Record<string, TRegisteredDomain>): TRegisteredDomain[] {
	return Object.values(domains).filter(
		(d): d is TRegisteredDomain & { topology: NonNullable<TRegisteredDomain["topology"]> } => !!d.topology?.vertexLabel,
	);
}

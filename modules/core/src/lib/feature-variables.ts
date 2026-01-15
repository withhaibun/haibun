/**
 * FeatureVariables - QuadStore-backed variable storage
 * 
 * Domain IS the predicate: (varName, domainType, value, shared)
 * Example: (user_role, roles, "admin", shared)
 * 
 * This enables semantic queries: queryQuads({ predicate: 'roles' })
 */

import { AStepper } from "./astepper.js";
import { isLiteralValue } from "./util/index.js";
import { TFeatureStep, TWorld } from './defs.js';
import { Origin, TOrigin, TProvenanceIdentifier, TStepValue, THaibunEvent } from '../schema/protocol.js';
import { DOMAIN_JSON, DOMAIN_STRING, normalizeDomainKey } from "./domain-types.js";
import { QuadStore } from "./quad-store.js";
import { IQuadStore, TQuad } from "./quad-types.js";

export const SHARED_GRAPH = 'variables';
export const META_GRAPH = 'meta';
export const OBSERVATION_GRAPH = 'observation';

export class FeatureVariables {
	private store: IQuadStore;
	// Keep the in-memory values map for backward compatibility
	private values: { [name: string]: TStepValue; };

	constructor(private world: TWorld, initial?: { [name: string]: TStepValue; }) {
		this.store = new QuadStore();
		this.values = initial ? { ...initial } : {};

		// Also store initial values as quads
		if (initial) {
			for (const [name, sv] of Object.entries(initial)) {
				this.storeAsQuad(name, sv);
			}
		}
	}

	/** Get the underlying QuadStore for direct queries */
	getStore(): IQuadStore {
		return this.store;
	}

	clear() {
		this.values = {};
		this.store.clear(SHARED_GRAPH);
	}

	all() {
		return { ...this.values };
	}

	toString() {
		return `tag ${this.world.tag} values ${Object.keys(this.values).length}`;
	}

	setJSON(label: string, value: object, origin: TOrigin, source: TFeatureStep) {
		this.set({ term: label, value: JSON.stringify(value), domain: DOMAIN_JSON, origin }, { in: source.in, seq: source.seqPath, when: `${source.action.stepperName}.${source.action.actionName}` });
	}

	setForStepper(stepper: string, sv: TStepValue, provenance: TProvenanceIdentifier, namedGraph?: string) {
		return this._set({ ...sv, term: `${stepper}.${sv.term}` }, provenance, namedGraph);
	}

	unset(name: string) {
		delete this.values[name];
	}

	set(sv: TStepValue, provenance: TProvenanceIdentifier, namedGraph?: string) {
		if (sv.term.match(/.*\..*/)) {
			throw Error('non-stepper variables cannot use dots');
		}

		if (this.world.options.envVariables[sv.term]) {
			throw Error(`Cannot overwrite environment variable "${sv.term}"`);
		}

		if (this.values[sv.term]?.readonly) {
			throw Error(`Cannot overwrite read-only variable "${sv.term}"`);
		}

		return this._set(sv, provenance, namedGraph);
	}

	_set(sv: TStepValue, provenance: TProvenanceIdentifier, namedGraph: string = SHARED_GRAPH) {
		const domainKey = normalizeDomainKey(sv.domain);
		const domain = this.world.domains[domainKey]
		if (domain === undefined) {
			throw Error(`Cannot set variable "${sv.term}": unknown domain "${sv.domain}"`);
		}
		// Auto-detect secret variables: if term contains "password" (case-insensitive), mark as secret
		const autoSecret = /password/i.test(sv.term);
		const normalized = { ...sv, domain: domainKey, secret: sv.secret || autoSecret };
		domain.coerce(normalized);
		const existingProvenance: TProvenanceIdentifier[] = this.values[sv.term]?.provenance;
		const provenances = existingProvenance ? [...existingProvenance, provenance] : [provenance];

		// Store in values map (keeps existing behavior)
		this.values[sv.term] = {
			...normalized,
			provenance: provenances
		};

		// Store as quad with domain as predicate
		this.storeAsQuad(sv.term, { ...normalized, provenance: provenances }, namedGraph);

		// Emit quad observation event for real-time graph building
		const timestamp = Date.now();
		this.world.eventLogger?.emit({
			id: `quad-${timestamp}`,
			timestamp,
			source: 'haibun',
			level: 'debug' as const,
			kind: 'artifact' as const,
			artifactType: 'json' as const,
			mimetype: 'application/json',
			json: {
				quadObservation: {
					subject: sv.term,
					predicate: domainKey,  // Domain IS the predicate
					object: normalized.value,
					namedGraph,
					// Move provenance to separate quads in meta namedGraph, don't embed
				}
			},
		});

		// Emit meta quads for origin/provenance/readonly if present
		if (sv.origin) {
			this.world.eventLogger?.emit({
				id: `quad-meta-origin-${timestamp}`,
				timestamp,
				source: 'haibun',
				level: 'debug' as const,
				kind: 'artifact' as const,
				artifactType: 'json' as const,
				mimetype: 'application/json',
				json: {
					quadObservation: {
						subject: sv.term,
						predicate: 'origin',
						object: sv.origin,
						namedGraph: META_GRAPH,
					}
				},
			});
		}
	}

	get<T>(name: string): T | undefined {
		if (!this.values[name]) return undefined;
		const domainKey = normalizeDomainKey(this.values[name].domain);
		const domain = this.world.domains[domainKey];
		if (!domain) {
			throw Error(`Cannot read variable "${name}": unknown domain "${this.values[name].domain}"`);
		}
		const ret = <T>domain.coerce({ ...this.values[name], domain: domainKey });
		return ret;
	}

	getJSON<T>(name: string): T | undefined {
		if (!this.values[name]) return undefined;

		if (this.values[name].domain !== DOMAIN_JSON) throw Error(`${name} is ${this.values[name].domain}, not json`);
		return JSON.parse(this.values[name].value as string);
	}

	/**
	 * Resolves a variable and its domain based on its actual origin. 
	 */
	resolveVariable(input: { term: string; origin: TOrigin; domain?: string }, featureStep?: TFeatureStep, steppers?: AStepper[]): TStepValue {
		const resolved: Partial<TStepValue> = {
			term: input.term,
			value: undefined,
		};

		// Handle {varName} syntax - extract variable name from braces
		let lookupTerm = input.term;
		if (lookupTerm.startsWith('{') && lookupTerm.endsWith('}')) {
			lookupTerm = lookupTerm.slice(1, -1);
		}

		const storedEntry = this.values[lookupTerm];

		if (!input.origin || input.origin === Origin.statement) {
			resolved.value = input.term;
			resolved.domain = input.domain;
		} else if (input.origin === Origin.env) {
			resolved.value = this.world.options.envVariables[lookupTerm]; // might be undefined
			resolved.domain = DOMAIN_STRING;
		} else if (input.origin === Origin.var) {
			if (storedEntry) {
				resolved.domain = storedEntry.domain;
				resolved.value = storedEntry.value;
				resolved.provenance = storedEntry.provenance;
			}
		} else if (input.origin === Origin.defined) {
			if (featureStep?.runtimeArgs?.[lookupTerm] !== undefined) {
				resolved.value = featureStep.runtimeArgs[lookupTerm];
				resolved.domain = DOMAIN_STRING;
				resolved.origin = Origin.var;
			} else if (this.world.options.envVariables[lookupTerm]) {
				resolved.value = this.world.options.envVariables[lookupTerm];
				resolved.domain = DOMAIN_STRING;
				resolved.origin = Origin.env;
			} else if (storedEntry) {
				resolved.value = storedEntry.value;
				resolved.domain = storedEntry.domain;
				resolved.provenance = storedEntry.provenance;
				resolved.origin = Origin.var;
			} else if (isLiteralValue(input.term)) {
				// Fallback: treat unquoted terms that look like literals as string values
				resolved.value = input.term;
				resolved.domain = DOMAIN_STRING;
			}
			// Note: for {varName} syntax, storedEntry is looked up using lookupTerm (without braces)
			// so this naturally resolves quantifier-bound variables
		} else if (input.origin === Origin.quoted) {
			// Check if this is {varName} syntax - if so, resolve as variable
			if (input.term.startsWith('{') && input.term.endsWith('}') && !input.term.includes(':')) {
				if (featureStep?.runtimeArgs?.[lookupTerm] !== undefined) {
					resolved.value = featureStep.runtimeArgs[lookupTerm];
					resolved.domain = DOMAIN_STRING;
					resolved.origin = Origin.var;
				} else if (storedEntry) {
					resolved.value = storedEntry.value;
					resolved.domain = storedEntry.domain;
					resolved.provenance = storedEntry.provenance;
					resolved.origin = Origin.var;
				}
			} else {
				resolved.value = input.term.replace(/^"|"$/g, '');
				resolved.domain = DOMAIN_STRING;
			}
		} else {
			throw new Error(`Unsupported origin type: ${input.origin}`);
		}

		if (resolved.value !== undefined) {
			// Ensure domain is defined before coercion, fallback to string if undefined
			const domainKey = resolved.domain ?? DOMAIN_STRING;
			const domain = this.world.domains[domainKey];
			if (!domain) {
				throw new Error(`Cannot resolve variable "${input.term}": unknown domain "${domainKey}"`);
			}
			resolved.value = domain.coerce({ ...resolved as TStepValue, domain: domainKey }, featureStep, steppers);
			resolved.domain = domainKey;
		}

		return resolved as TStepValue;
	}

	getDomainValues(domainName: string): { values: unknown[], error?: string } {
		const domainKey = normalizeDomainKey(domainName);
		const domainDef = this.world.domains[domainKey];

		if (!domainDef) {
			return { values: [], error: `Domain "${domainName}" is not defined` };
		}

		if (Array.isArray(domainDef.values) && domainDef.values.length > 0) {
			return { values: domainDef.values };
		}

		const allVars = this.all();
		const memberValues = Object.values(allVars)
			.filter(v => v.domain && normalizeDomainKey(v.domain) === domainKey)
			.map(v => v.value);

		return { values: memberValues };
	}

	// =========================================================================
	// QuadStore-specific methods for first-order logic integration
	// =========================================================================

	/**
	 * Query quads. The predicate IS the domain type.
	 * Example: queryQuads({ predicate: 'roles' }) to find all role-typed values.
	 */
	queryQuads(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): TQuad[] {
		const queryPattern: Record<string, unknown> = { ...pattern, namedGraph: pattern.namedGraph };
		return this.store.query(queryPattern);
	}

	/** Check existence of a quad */
	existsQuad(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): boolean {
		return this.queryQuads(pattern).length > 0;
	}

	/** Count quads matching pattern */
	countQuads(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): number {
		return this.queryQuads(pattern).length;
	}

	/** Add a quad directly (for non-variable observations like HTTP traces) */
	addQuad(quad: Omit<TQuad, 'timestamp'>): void {
		this.store.add(quad);

		// Emit event for graph visualization
		const timestamp = Date.now();
		this.world.eventLogger?.emit({
			id: `quad-${timestamp}-${quad.subject}-${quad.predicate}`,
			timestamp,
			source: 'haibun',
			level: 'debug' as const,
			kind: 'artifact' as const,
			artifactType: 'json' as const,
			mimetype: 'application/json',
			json: {
				quadObservation: quad
			},

		} as THaibunEvent);
	}

	/** Remove quads matching a pattern */
	removeQuad(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): void {
		this.store.remove(pattern);
	}

	/** Get all quads */
	allQuads(): TQuad[] {
		return this.store.all();
	}

	/** Check if a variable is marked as secret */
	isSecret(name: string): boolean {
		return this.values[name]?.secret === true;
	}

	// =========================================================================
	// Private helpers
	// =========================================================================

	private storeAsQuad(name: string, sv: TStepValue, namedGraph: string = SHARED_GRAPH): void {
		const domainKey = normalizeDomainKey(sv.domain);
		// Domain IS the predicate: (name, domainType, value, shared)
		this.store.add({ subject: name, predicate: domainKey, object: sv.value, namedGraph });

		// Store metadata as separate quads in META namedGraph
		if (sv.origin) {
			this.store.add({ subject: name, predicate: 'origin', object: sv.origin, namedGraph: META_GRAPH });
		}
		if (sv.provenance) {
			this.store.add({ subject: name, predicate: 'provenance', object: sv.provenance, namedGraph: META_GRAPH });
		}
		if (sv.readonly) {
			this.store.add({ subject: name, predicate: 'readonly', object: true, namedGraph: META_GRAPH });
		}
		if (sv.secret) {
			this.store.add({ subject: name, predicate: 'secret', object: true, namedGraph: META_GRAPH });
		}
	}
}

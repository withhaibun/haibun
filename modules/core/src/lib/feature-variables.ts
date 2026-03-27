import { AStepper } from "./astepper.js";
import { isLiteralValue } from "./util/index.js";
import { parseDotPath, navigateValue } from "./util/dot-path.js";
import { TFeatureStep, TWorld } from './defs.js';
import { Origin, TOrigin, TProvenanceIdentifier, TStepValue, THaibunEvent } from '../schema/protocol.js';
import { DOMAIN_JSON, DOMAIN_STRING, normalizeDomainKey } from "./domain-types.js";
import { QuadStore } from "./quad-store.js";
import { IQuadStore, TQuad } from "./quad-types.js";

export const SHARED_GRAPH = 'variables';
export const META_GRAPH = 'meta';
export const OBSERVATION_GRAPH = 'observation';
export const OBSCURED_VALUE = '[o̴b̵s̵c̷u̶r̸e̵d̵]';

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
		const normalized = { ...sv, domain: domainKey };
		domain.coerce(normalized);
		const existingProvenance: TProvenanceIdentifier[] = this.values[sv.term]?.provenance;
		const provenances = existingProvenance ? [...existingProvenance, provenance] : [provenance];

		this.values[sv.term] = {
			...normalized,
			provenance: provenances
		};

		this.storeAsQuad(sv.term, { ...normalized, provenance: provenances }, namedGraph);

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
					predicate: domainKey,
					object: this.isSecret(sv.term) ? OBSCURED_VALUE : normalized.value,
					namedGraph,
				}
			},
		});

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

	/**
	 * Resolves a variable and its domain based on its actual origin.
	 * Requires explicit options.secure to return the real value of a secret.
	 */
	resolveVariable(input: { term: string; origin: TOrigin; domain?: string }, featureStep?: TFeatureStep, steppers?: AStepper[], options: { secure: boolean } = { secure: false }): TStepValue {
		const resolved: Partial<TStepValue> = {
			term: input.term,
			value: undefined,
		};

		let lookupTerm = input.term;
		if (lookupTerm.startsWith('{') && lookupTerm.endsWith('}')) {
			lookupTerm = lookupTerm.slice(1, -1);
		}

		const storedEntry = this.values[lookupTerm];

		if (!input.origin || input.origin === Origin.statement) {
			resolved.value = input.term;
			resolved.domain = input.domain;
		} else if (input.origin === Origin.env) {
			resolved.value = this.world.options.envVariables[lookupTerm];
			resolved.domain = DOMAIN_STRING;
			resolved.origin = Origin.env;
			resolved.secret = this.isSecret(lookupTerm);
		} else if (input.origin === Origin.var) {
			if (storedEntry) {
				resolved.domain = storedEntry.domain;
				resolved.value = storedEntry.value;
				resolved.provenance = storedEntry.provenance;
				resolved.readonly = storedEntry.readonly;
				resolved.secret = storedEntry.secret; // Propagate secret property
				resolved.origin = Origin.var;
				if (resolved.secret === undefined) {
					resolved.secret = this.isSecret(lookupTerm);
				}
			} else if (lookupTerm.includes('.')) {
				const dotResult = this.resolveDotPath(lookupTerm);
				if (dotResult.found) {
					resolved.value = dotResult.value;
					resolved.domain = DOMAIN_STRING;
					resolved.origin = Origin.var;
				}
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
				resolved.secret = this.isSecret(lookupTerm);
			} else if (storedEntry) {
				resolved.value = storedEntry.value;
				resolved.domain = storedEntry.domain;
				resolved.provenance = storedEntry.provenance;
				resolved.readonly = storedEntry.readonly;
				resolved.origin = Origin.var;
				resolved.secret = storedEntry.secret;
				if (resolved.secret === undefined) {
					resolved.secret = this.isSecret(lookupTerm);
				}
			} else if (lookupTerm.includes('.')) {
				const dotResult = this.resolveDotPath(lookupTerm);
				if (dotResult.found) {
					resolved.value = dotResult.value;
					resolved.domain = DOMAIN_STRING;
					resolved.origin = Origin.var;
				} else if (isLiteralValue(input.term)) {
					// Fallback: treat unquoted terms that look like literals as string values
					resolved.value = input.term;
					resolved.domain = DOMAIN_STRING;
				}
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
					resolved.readonly = storedEntry.readonly;
					resolved.origin = Origin.var;
					resolved.secret = storedEntry.secret;
					if (resolved.secret === undefined) {
						resolved.secret = this.isSecret(lookupTerm);
					}
				}
			} else {
				resolved.value = input.term.replace(/^"|"$/g, '');
				resolved.domain = input.domain ?? DOMAIN_STRING;
			}
		} else {
			throw new Error(`Unsupported origin type: ${input.origin}`);
		}

		if (resolved.value !== undefined) {
			const rawDomainKey = resolved.domain ?? DOMAIN_STRING;
			// Normalize union domains (e.g. "string | other" → sorted "other | string") and look up
			const parts = rawDomainKey.split(' | ').map(s => s.trim()).filter(Boolean).sort();
			const sortedKey = parts.join(' | ');
			// For union domains with unregistered parts, fall back to string; for single domains, require registration
			const isUnion = parts.length > 1;
			const domainKey = this.world.domains[sortedKey] ? sortedKey : (isUnion ? DOMAIN_STRING : sortedKey);
			const domain = this.world.domains[domainKey];
			if (!domain) {
				throw new Error(`Cannot resolve variable "${input.term}": unknown domain "${domainKey}"`);
			}
			resolved.value = domain.coerce({ ...resolved as TStepValue, domain: domainKey }, featureStep, steppers);
			resolved.domain = domainKey;

			const isSecretValue = resolved.secret === true || this.isSecret(lookupTerm);
			const fromVariableOrEnv = resolved.origin === Origin.env || resolved.origin === Origin.var;

			if (!options.secure && fromVariableOrEnv && isSecretValue) {
				resolved.value = OBSCURED_VALUE;
			}
		}

		return resolved as TStepValue;
	}

	/** Try dot-path navigation into a stored structured value. */
	private resolveDotPath(lookupTerm: string): { value: unknown; domain: string; found: boolean } {
		const { baseName, pathSegments } = parseDotPath(lookupTerm);
		if (pathSegments.length === 0) return { value: undefined, domain: DOMAIN_STRING, found: false };
		const baseEntry = this.values[baseName];
		if (!baseEntry) return { value: undefined, domain: DOMAIN_STRING, found: false };
		let baseValue = baseEntry.value;
		// Parse JSON strings into objects for navigation
		if (typeof baseValue === 'string') {
			try { baseValue = JSON.parse(baseValue); } catch { return { value: undefined, domain: DOMAIN_STRING, found: false }; }
		}
		const result = navigateValue(baseValue, pathSegments);
		return { ...result, domain: baseEntry.domain ?? DOMAIN_STRING };
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

	get(term: string, secure: boolean = false) {
		return this.resolveVariable({ term, origin: Origin.defined }, undefined, undefined, { secure }).value;
	}

	queryQuads(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): TQuad[] {
		const queryPattern: Record<string, unknown> = { ...pattern, namedGraph: pattern.namedGraph };
		return this.store.query(queryPattern);
	}

	existsQuad(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): boolean {
		return this.queryQuads(pattern).length > 0;
	}

	countQuads(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): number {
		return this.queryQuads(pattern).length;
	}

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

	removeQuad(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): void {
		this.store.remove(pattern);
	}

	allQuads(): TQuad[] {
		return this.store.all();
	}

	isSecret(name: string): boolean {
		if (this.values[name]?.secret) {
			return true;
		}
		if (this.values[name]?.secret === false) {
			return false;
		}
		return /(password|secret)/i.test(name);
	}

	getSecrets(): { [name: string]: string } {
		const secrets: { [name: string]: string } = {};
		const envVars = this.world.options.envVariables;
		for (const [key, value] of Object.entries(envVars)) {
			if (this.isSecret(key)) {
				secrets[key] = String(value);
			}
		}
		for (const [key, variable] of Object.entries(this.all())) {
			if (this.isSecret(key)) {
				secrets[key] = String(variable.value);
			}
		}
		return secrets;
	}

	// =========================================================================
	// Private helpers
	// =========================================================================

	private storeAsQuad(name: string, sv: TStepValue, namedGraph: string = SHARED_GRAPH): void {
		const domainKey = normalizeDomainKey(sv.domain);
		// Domain IS the predicate: (name, domainType, value, shared)
		this.store.add({ subject: name, predicate: domainKey, object: sv.value, namedGraph });

		if (sv.origin) {
			this.store.add({ subject: name, predicate: 'origin', object: sv.origin, namedGraph: META_GRAPH });
		}
		if (sv.provenance) {
			this.store.add({ subject: name, predicate: 'provenance', object: sv.provenance, namedGraph: META_GRAPH });
		}
		if (sv.readonly) {
			this.store.add({ subject: name, predicate: 'readonly', object: true, namedGraph: META_GRAPH });
		}
	}
}

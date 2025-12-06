import { OK, TStepArgs, TFeatureStep, TWorld, IStepperCycles, TStartScenario, Origin, TOrigin, TProvenanceIdentifier, TRegisteredDomain } from '../lib/defs.js';
import { TAnyFixme } from '../lib/fixme.js';
import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';
import { actionNotOK, actionOK } from '../lib/util/index.js';
import { FeatureVariables } from '../lib/feature-variables.js';
import { DOMAIN_STATEMENT, DOMAIN_STRING, normalizeDomainKey, createEnumDomainDefinition, registerDomains } from '../lib/domain-types.js';
import { EExecutionMessageType } from '../lib/interfaces/logger.js';
import {  resolveVariable } from '../lib/util/variables.js';

const clearVars = (vars) => () => {
	vars.getWorld().shared.clear();
	return;
};

const cycles = (variablesStepper: VariablesStepper): IStepperCycles => ({
	startFeature: clearVars(variablesStepper),
	startScenario: ({ featureVars }: TStartScenario) => {
		variablesStepper.getWorld().shared = new FeatureVariables(variablesStepper.getWorld(), { ...featureVars.all() });
		return Promise.resolve();
	},
});

class VariablesStepper extends AStepper implements IHasCycles {
	cycles = cycles(this);
	steppers: AStepper[];
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.world = world;
		this.steppers = steppers;
		await Promise.resolve();
	}
	isSet(what: string, origin: TOrigin = Origin.fallthrough) {
		const effectiveOrigin = origin === Origin.quoted ? Origin.fallthrough : origin;
		const resolved = resolveVariable({ term: what, origin: effectiveOrigin }, this.getWorld());
		if (resolved.origin !== Origin.fallthrough) {
			return OK;
		}
		return actionNotOK(`${what} not set`);
	}

	steps = {
		defineOrderedSet: {
			precludes: [`${VariablesStepper.name}.defineSet`],
			gwta: `ordered set of {domain: string} is {values:${DOMAIN_STATEMENT}}`,
			action: ({ domain, values }: { domain: string, values: TFeatureStep[] }, featureStep: TFeatureStep) => this.registerDomainFromStatement(domain, values, featureStep, { ordered: true, label: 'ordered set' })
		},
		defineSet: {
			gwta: `set of {domain: string} is {values:${DOMAIN_STATEMENT}}`,
			action: ({ domain, values }: { domain: string, values: TFeatureStep[] }, featureStep: TFeatureStep) => this.registerDomainFromStatement(domain, values, featureStep, { ordered: false, label: 'set' })
		},
		statementSetValues: {
			expose: false,
			gwta: '\\[{items: string}\\]',
			action: () => OK,
		},
		combineAs: {
			gwta: 'combine {p1} and {p2} as {domain} to {what}',
			precludes: [`${VariablesStepper.name}.combine`],
			action: ({ p1, p2, domain }: { p1: string, p2: string, domain: string }, featureStep: TFeatureStep) => {
				const { term } = featureStep.action.stepValuesMap.what;
				this.getWorld().shared.set({ term: String(term), value: `${p1}${p2}`, domain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return Promise.resolve(OK);
			}
		},
		combine: {
			gwta: 'combine {p1} and {p2} to {what}',
			action: ({ p1, p2 }: TStepArgs, featureStep: TFeatureStep) => {
				const { term } = featureStep.action.stepValuesMap.what;
				this.getWorld().shared.set({ term: String(term), value: `${p1}${p2}`, domain: DOMAIN_STRING, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return Promise.resolve(OK);
			}
		},
		increment: {
			gwta: 'increment {what}',
			action: (args: TStepArgs, featureStep: TFeatureStep) => {
				let { term, domain, origin } = featureStep.action.stepValuesMap.what;
				// If origin is missing or fallthrough, we might need to resolve it properly.
				// But resolveVariable handles fallthrough.
				if (!origin) {
					origin = Origin.fallthrough;
				}
				// term = interpolate(term,  this.getWorld());
				const resolved = resolveVariable({ term, origin, domain }, this.getWorld());
				const presentVal = resolved.value;

				const stored = this.getWorld().shared.all()[term];

				// If no domain supplied by the step, try to infer it from stored variable metadata.
				let effectiveDomain = domain;
				if ((!effectiveDomain || effectiveDomain === 'string') && stored && stored.domain) {
					effectiveDomain = stored.domain;
				}

				// If the domain is an ordered enum, advance to the next enum value.
				const domainKey = normalizeDomainKey(effectiveDomain);
				const registered = this.getWorld().domains[domainKey];

				if (registered && registered.comparator) {
					// Prefer explicit values array on the registered domain if available.
					const enumValues = Array.isArray(registered.values) && registered.values.length ? registered.values : undefined;
					if (enumValues && enumValues.length > 0) {
						// If not set yet, do not silently initialize — treat increment on unset as an error.
						if (presentVal === undefined) {
							return actionNotOK(`${term} not set`);
						}
						const idx = enumValues.indexOf(String(presentVal));
						if (idx === -1) {
							return actionNotOK(`${term} has value "${presentVal}" which is not in domain values`);
						}
						const nextIdx = Math.min(enumValues.length - 1, idx + 1);
						const nextVal = enumValues[nextIdx];
						if (nextVal === presentVal) {
							return Promise.resolve(OK);
						}
						this.getWorld().shared.set({ term: String(term), value: nextVal, domain: effectiveDomain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
						return Promise.resolve(OK);
					}
				}
				// Fallback: numeric increment behavior
				// For numeric fallback, do not initialize on unset — incrementing an unset variable should fail.
				if (presentVal === undefined) {
					return actionNotOK(`${term} not set`);
				}
				const numVal = Number(presentVal);
				if (isNaN(numVal)) {
					return actionNotOK(`cannot increment non-numeric variable ${term} with value "${presentVal}"`);
				}
				const newNum = numVal + 1;
				this.getWorld().shared.set({ term: String(term), value: newNum, domain: effectiveDomain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				const messageContext = {
					incident: EExecutionMessageType.ACTION,
					incidentDetails: { json: { incremented: { [term]: newNum } } },
				}
				this.getWorld().logger.info(`incremented ${term} to ${newNum}`, messageContext);
				return Promise.resolve(OK);
			}
		},
		showEnv: {
			gwta: 'show env',
			expose: false,
			action: () => {
				// only available locally since it might contain sensitive info.
				console.info('env', this.world.options.envVariables);
				return Promise.resolve(OK);
			}
		},
		showVars: {
			gwta: 'show vars',
			action: () => {
				console.info('vars', this.getWorld().shared.all());
				return Promise.resolve(actionOK({ artifact: { artifactType: 'json', json: { vars: this.getWorld().shared.all() } } }));
			},
		},
		set: {
			gwta: 'set( empty)? {what: string} to {value: string}',
			precludes: ['Haibun.prose'],
			action: (args: TStepArgs, featureStep: TFeatureStep) => {
				const emptyOnly = !!featureStep.in.match(/set empty /);
				const { term, domain, origin } = featureStep.action.stepValuesMap.what;

				if (emptyOnly && this.getWorld().shared.get(term) !== undefined) {
					return OK;
				}

				try {
					this.getWorld().shared.set({ term: String(term), value: args.value, domain, origin }, provenanceFromFeatureStep(featureStep));
					return Promise.resolve(OK);
				} catch (e) {
					return actionNotOK(e instanceof Error ? e.message : String(e));
				}
			}
		},
		setAs: {
			gwta: 'set( empty)? {what: string} as {domain: string} to {value: string}',
			precludes: [`${VariablesStepper.name}.set`],
			action: ({ value, domain }: { value: string, domain: string }, featureStep: TFeatureStep) => {
				const emptyOnly = !!featureStep.in.match(/set empty /);
				const { term, origin } = featureStep.action.stepValuesMap.what;

				if (emptyOnly && this.getWorld().shared.get(term) !== undefined) {
					return OK;
				}

				try {
					this.getWorld().shared.set({ term: String(term), value: value, domain, origin }, provenanceFromFeatureStep(featureStep));
					return Promise.resolve(OK);
				} catch (e) {
					return actionNotOK(e instanceof Error ? e.message : String(e));
				}
			}
		},
		unset: {
			gwta: 'unset {what: string}',
			action: ({ what }: TStepArgs, featureStep: TFeatureStep) => {
				const { term } = featureStep.action.stepValuesMap.what;
				this.getWorld().shared.unset(term);
				return Promise.resolve(OK);
			}
		},
		setRandom: {
			precludes: [`${VariablesStepper.name}.set`],
			gwta: `set( empty)? {what: string} to {length: number} random characters`,
			action: ({ length }: { length: number }, featureStep: TFeatureStep) => {
				const emptyOnly = !!featureStep.in.match(/set empty /);
				const { term } = featureStep.action.stepValuesMap.what;

				if (length < 1 || length > 100) {
					return actionNotOK(`length ${length} must be between 1 and 100`);
				}
				if (emptyOnly && this.getWorld().shared.get(term) !== undefined) {
					return OK;
				}

				let rand = '';
				while (rand.length < length) {
					rand += Math.random().toString(36).substring(2, 2 + length);
				}
				rand = rand.substring(0, length);
				this.getWorld().shared.set({ term: String(term), value: rand, domain: DOMAIN_STRING, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return Promise.resolve(OK);
			}
		},
		is: {
			gwta: 'variable {what} is {value}',
			match: /^variable\s+.+?\s+is\s+(?!less\s+than\b).+/,
			action: ({ what, value }: { what: string, value: string }, featureStep: TFeatureStep) => {
				void what; // used for type checking
				let { term, domain, origin } = featureStep.action.stepValuesMap.what;
				// term = interpolate(term,  this.getWorld());

				const effectiveOrigin = origin === Origin.quoted ? Origin.fallthrough : origin;
				const resolved = resolveVariable({ term, origin: effectiveOrigin }, this.getWorld());
				let val = resolved.origin === Origin.fallthrough ? undefined : resolved.value;

				if (resolved.domain) {
					domain = resolved.domain;
				}

				const normalized = normalizeDomainKey(domain);
				const domainEntry = this.getWorld().domains[normalized];
				if (!domainEntry) {
					return actionNotOK(`No domain coercer found for domain "${domain}"`);
				}

				if (val !== undefined) {
					val = domainEntry.coerce({ domain: normalized, value: val, term, origin: resolved.origin });
				}

				const asDomain = domainEntry.coerce({ domain: normalized, value, term, origin: 'quoted' })
				return JSON.stringify(val) === JSON.stringify(asDomain) ? OK : actionNotOK(`${term} is ${JSON.stringify(val)}, not ${JSON.stringify(value)}`);
			}
		},
		isLessThan: {
			gwta: 'variable {what} is less than {value}',
			precludes: ['VariablesStepper.is'],
			match: /^variable\s+.+?\s+is\s+less\s+than\s+.+/,
			action: ({ what, value }: { what: string, value: string }, featureStep: TFeatureStep) => {
				void what;
				const term = featureStep?.action?.stepValuesMap?.what?.term ?? what;
				const stored = this.getWorld().shared.all()[term];
				if (!stored) {
					return actionNotOK(`${term} is not set`);
				}
				try {
					const domainKey = normalizeDomainKey(stored.domain);
					const domainEntry = this.getWorld().domains[domainKey];
					if (!domainEntry) {
						throw new Error(`No domain coercer found for domain "${domainKey}"`);
					}
					const left = domainEntry.coerce({ ...stored, domain: domainKey }, featureStep, this.steppers);
					const right = domainEntry.coerce({ term: `${term}__comparison`, value, domain: domainKey, origin: Origin.quoted }, featureStep, this.steppers);
					const comparison = compareDomainValues(domainEntry, left, right);
					if (comparison < 0) {
						return OK;
					}
					return actionNotOK(`${term} (${renderComparable(left)}) is not less than ${renderComparable(right)}`);
				} catch (error) {
					return actionNotOK(error instanceof Error ? error.message : String(error));
				}
			}
		},
		isSet: {
			precludes: ['VariablesStepper.is'],
			gwta: 'variable {what: string} is set',
			action: ({ what }: TStepArgs, featureStep: TFeatureStep) => {
				// Use term from stepValuesMap when available (normal execution), fall back to what for kireji
				const term = featureStep?.action?.stepValuesMap?.what?.term ?? what;
				const origin = featureStep?.action?.stepValuesMap?.what?.origin ?? Origin.fallthrough;
				// term = interpolate(term as string,  this.getWorld());
				return this.isSet(term as string, origin);
			}
		},
		showVar: {
			gwta: 'show var {what}',
			action: (args: TStepArgs, featureStep: TFeatureStep) => {
				const { term } = featureStep.action.stepValuesMap.what;
				// term = interpolate(term, this.getWorld());
				const stepValue = this.getWorld().shared.all()[term];
				if (!stepValue) {
					this.getWorld().logger.info(`is undefined`);
				} else {
					this.getWorld().logger.info(`is ${JSON.stringify({ ...stepValue, provenance: stepValue.provenance.map((p, i) => ({ [i]: { in: p.in, seq: p.seq.join(','), when: p.when } })) }, null, 2)}`);
				}
				return actionOK({ artifact: { artifactType: 'json', json: { json: stepValue } } });
			}
		},
		showDomains: {
			gwta: 'show domains',
			action: () => {
				const domains = this.getWorld().domains;
				const allVars = this.getWorld().shared.all();
				const summary: Record<string, TAnyFixme> = {};

				for (const [name, def] of Object.entries(domains)) {
					// Count variables in this domain
					let members = 0;
					for (const variable of Object.values(allVars)) {
						if (variable.domain && normalizeDomainKey(variable.domain) === name) {
							members++;
						}
					}

					// Determine type from schema or values
					let type: string | string[] = JSON.stringify(def);
					if (def.values) {
						type = def.values;
					} else if (def.schema && (def as TRegisteredDomain).schema._def) {
						type = def.schema._def.typeName;
					}

					summary[name] = {
						type,
						members,
						ordered: !!def.comparator
					};
				}
				this.getWorld().logger.info(`Domains: ${JSON.stringify(summary, null, 2)}`);
				return OK;
			}
		},
		showDomain: {
			gwta: 'show domain {name}',
			action: ({ name }: { name: string }) => {
				const domain = this.getWorld().domains[name];
				if (!domain) {
					return actionNotOK(`Domain "${name}" not found`);
				}
				const allVars = this.getWorld().shared.all();
				const members: Record<string, TAnyFixme> = {};
				for (const [key, variable] of Object.entries(allVars)) {
					if (variable.domain && normalizeDomainKey(variable.domain) === name) {
						members[key] = variable.value;
					}
				}
				this.getWorld().logger.info(`Domain "${name}": ${JSON.stringify({ ...domain, members }, null, 2)}`);
				return OK;
			}
		},
	} satisfies TStepperSteps;

	private registerDomainFromStatement(domain: string, valueFragments: TFeatureStep[] | undefined, featureStep: TFeatureStep, options?: { ordered?: boolean; label?: string; description?: string }) {
		try {
			const values = extractValuesFromFragments(valueFragments, featureStep.action.stepValuesMap.values?.term ?? featureStep.in);
			const domainKey = normalizeDomainKey(domain);
			if (this.getWorld().domains[domainKey]) {
				return actionNotOK(`Domain "${domainKey}" already exists`);
			}
			const definition = createEnumDomainDefinition({ name: domainKey, values, description: options?.description, ordered: options?.ordered });
			registerDomains(this.getWorld(), [[definition]]);
			return OK;
		} catch (error) {
			return actionNotOK(error instanceof Error ? error.message : String(error));
		}
	}
}

export default VariablesStepper;

export const didNotOverwrite = (what: string, present: string, value: string) => ({
	overwrite: { summary: `did not overwrite ${what} value of "${present}" with "${value}"` },
});

export function provenanceFromFeatureStep(featureStep: TFeatureStep): TProvenanceIdentifier {
	return {
		in: featureStep.in,
		seq: featureStep.seqPath,
		when: `${featureStep.action.stepperName}.steps.${featureStep.action.actionName}`
	};
}

const QUOTED_STRING = /"([^"]+)"/g;

const extractValuesFromFragments = (valueFragments?: TFeatureStep[], fallback?: string) => {
	if (valueFragments?.length) {
		const innerChunks = valueFragments.map(fragment => {
			const raw = fragment.in ?? fragment.action?.stepValuesMap?.items?.term ?? '';
			const trimmed = raw.trim();
			if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
				return trimmed.slice(1, -1).trim();
			}
			return trimmed;
		}).filter(Boolean);
		const inner = innerChunks.join(' ').trim();
		if (!inner) {
			throw new Error('Set values cannot be empty');
		}
		return parseQuotedOrWordList(inner);
	}
	if (fallback) {
		return parseBracketedValues(fallback);
	}
	throw new Error('Set statement missing values');
};

const parseBracketedValues = (raw: string) => {
	const trimmed = raw.trim();
	const start = trimmed.indexOf('[');
	const end = trimmed.lastIndexOf(']');
	if (start === -1 || end === -1 || end <= start) {
		throw new Error('Set values must include [ ]');
	}
	const inner = trimmed.substring(start + 1, end).trim();
	return parseQuotedOrWordList(inner);
};

const parseQuotedOrWordList = (value: string): string[] => {
	const quoted = [...value.matchAll(QUOTED_STRING)].map(match => match[1].trim()).filter(Boolean);
	if (quoted.length) {
		return quoted;
	}
	return value.split(/[\s,]+/).map(token => token.trim()).filter(Boolean);
};

const compareDomainValues = (domain: { comparator?: (a: unknown, b: unknown) => number }, left: unknown, right: unknown): number => {
	if (domain.comparator) {
		return domain.comparator(left, right);
	}
	if (typeof left === 'number' && typeof right === 'number') {
		return left - right;
	}
	if (left instanceof Date && right instanceof Date) {
		return left.getTime() - right.getTime();
	}
	throw new Error('Domain does not support magnitude comparison');
};

const renderComparable = (value: unknown) => {
	if (value instanceof Date) {
		return value.toISOString();
	}
	return JSON.stringify(value);
};


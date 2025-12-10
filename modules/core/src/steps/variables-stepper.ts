import { z } from 'zod';
import { OK, TStepArgs, TFeatureStep, TWorld, IStepperCycles, TStartScenario, Origin, TProvenanceIdentifier, TRegisteredDomain, TDomainDefinition, TOrigin, TActionResult } from '../lib/defs.js';
import { TAnyFixme } from '../lib/fixme.js';
import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';
import { actionOK, actionNotOK, getStepTerm, isLiteralValue } from '../lib/util/index.js';
import { FeatureVariables } from '../lib/feature-variables.js';
import { DOMAIN_STATEMENT, DOMAIN_STRING, normalizeDomainKey, createEnumDomainDefinition, registerDomains } from '../lib/domain-types.js';
import { EExecutionMessageType } from '../lib/interfaces/logger.js';

const clearVars = (vars) => () => {
	vars.getWorld().shared.clear();
	return;
};

const cycles = (variablesStepper: VariablesStepper): IStepperCycles => ({
	startFeature: clearVars(variablesStepper),
	startScenario: ({ scopedVars }: TStartScenario) => {
		variablesStepper.getWorld().shared = new FeatureVariables(variablesStepper.getWorld(), { ...scopedVars.all() });
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
	steps: TStepperSteps = {
		defineOpenSet: {
			gwta: `set of {domain: string} as {superdomains: ${DOMAIN_STATEMENT}}`,
			action: ({ domain, superdomains }: { domain: string, superdomains: TFeatureStep[] }, featureStep: TFeatureStep) => this.registerSubdomainFromStatement(domain, superdomains, featureStep)
		},
		defineOrderedSet: {
			precludes: [`${VariablesStepper.name}.defineValuesSet`, `${VariablesStepper.name}.defineSet`],
			gwta: `ordered set of {domain: string} is {values:${DOMAIN_STATEMENT}}`,
			action: ({ domain, values }: { domain: string, values: TFeatureStep[] }, featureStep: TFeatureStep) => this.registerValuesDomainFromStatement(domain, values, featureStep, { ordered: true, label: 'ordered set' })
		},
		defineValuesSet: {
			gwta: `set of {domain: string} is {values:${DOMAIN_STATEMENT}}`,
			action: ({ domain, values }: { domain: string, values: TFeatureStep[] }, featureStep: TFeatureStep) => this.registerValuesDomainFromStatement(domain, values, featureStep, { ordered: false, label: 'set' })
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
				if (p1 === undefined) return actionNotOK(`p1 not set`);
				if (p2 === undefined) return actionNotOK(`p2 not set`);
				const { term } = featureStep.action.stepValuesMap.what;
				this.getWorld().shared.set({ term: String(term), value: `${p1}${p2}`, domain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return Promise.resolve(OK);
			}
		},
		combine: {
			gwta: 'combine {p1} and {p2} to {what}',
			action: ({ p1, p2 }: TStepArgs, featureStep: TFeatureStep) => {
				if (p1 === undefined) return actionNotOK(`p1 not set`);
				if (p2 === undefined) return actionNotOK(`p2 not set`);
				const { term } = featureStep.action.stepValuesMap.what;
				this.getWorld().shared.set({ term: String(term), value: `${p1}${p2}`, domain: DOMAIN_STRING, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				return Promise.resolve(OK);
			}
		},
		increment: {
			gwta: 'increment {what}',
			action: (_: TStepArgs, featureStep: TFeatureStep) => {
				const { term, domain } = featureStep.action.stepValuesMap.what;
				const resolved = this.getWorld().shared.resolveVariable({ term, origin: Origin.var, domain });
				const presentVal = resolved.value;
				const effectiveDomain = resolved.domain;

				if (presentVal === undefined) {
					return actionNotOK(`${term} not set`);
				}

				// If domain is an ordered enum, advance to the next enum value
				const domainKey = effectiveDomain ? normalizeDomainKey(effectiveDomain) : undefined;
				const registered = domainKey ? this.getWorld().domains[domainKey] : undefined;
				if (registered?.comparator && Array.isArray(registered.values) && registered.values.length) {
					const enumValues = registered.values;
					const idx = enumValues.indexOf(String(presentVal));
					if (idx === -1) {
						return actionNotOK(`${term} has value "${presentVal}" which is not in domain values`);
					}
					const nextIdx = Math.min(enumValues.length - 1, idx + 1);
					const nextVal = enumValues[nextIdx];
					if (nextVal === presentVal) {
						return OK;
					}
					this.getWorld().shared.set({ term: String(term), value: nextVal, domain: effectiveDomain!, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
					return OK;
				}

				// Fallback: numeric increment
				const numVal = Number(presentVal);
				if (isNaN(numVal)) {
					return actionNotOK(`cannot increment non-numeric variable ${term} with value "${presentVal}"`);
				}
				const newNum = numVal + 1;
				this.getWorld().shared.set({ term: String(term), value: String(newNum), domain: effectiveDomain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				this.getWorld().logger.info(`incremented ${term} to ${newNum}`, {
					incident: EExecutionMessageType.ACTION,
					incidentDetails: { json: { incremented: { [term]: newNum } } },
				});
				return OK;
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
				const { term, domain, origin } = featureStep.action.stepValuesMap.what;
				const valMap = featureStep.action.stepValuesMap.value;

				const resolved = resolveValueOrLiteral(valMap, args.value as string | undefined);
				if (resolved.error) return actionNotOK(resolved.error);

				const skip = shouldSkipEmpty(featureStep, term, this.getWorld().shared);
				if (skip) return skip;

				return trySetVariable(this.getWorld().shared, { term, value: resolved.value, domain: domain || DOMAIN_STRING, origin }, provenanceFromFeatureStep(featureStep));
			}
		},
		setAs: {
			gwta: 'set( empty)? {what} as {domain} to {value}',
			precludes: [`${VariablesStepper.name}.set`],
			action: ({ value, domain }: { value: string, domain: string }, featureStep: TFeatureStep) => {
				const readonly = !!featureStep.in.match(/ as read-only /);
				const { term, origin } = featureStep.action.stepValuesMap.what;
				const valMap = featureStep.action.stepValuesMap.value;

				const resolved = resolveValueOrLiteral(valMap, value);
				if (resolved.error) return actionNotOK(resolved.error);

				const skip = shouldSkipEmpty(featureStep, term, this.getWorld().shared);
				if (skip) return skip;

				// Fallback for unquoted domain names (e.g. 'as number') that resolve to undefined
				let effectiveDomain = domain ?? getStepTerm(featureStep, 'domain');
				if (effectiveDomain) {
					if (effectiveDomain.startsWith('read-only ')) {
						effectiveDomain = effectiveDomain.replace('read-only ', '');
					}
					if (effectiveDomain.startsWith('"') && effectiveDomain.endsWith('"')) {
						effectiveDomain = effectiveDomain.slice(1, -1);
					}
				}

				let finalValue = resolved.value;
				if (typeof finalValue === 'string' && finalValue.startsWith('"') && finalValue.endsWith('"')) {
					finalValue = finalValue.slice(1, -1);
				}
				return trySetVariable(this.getWorld().shared, { term, value: finalValue, domain: effectiveDomain, origin, readonly }, provenanceFromFeatureStep(featureStep));
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
				const { term } = featureStep.action.stepValuesMap.what;

				if (length < 1 || length > 100) {
					return actionNotOK(`length ${length} must be between 1 and 100`);
				}

				const skip = shouldSkipEmpty(featureStep, term, this.getWorld().shared);
				if (skip) return skip;

				let rand = '';
				while (rand.length < length) {
					rand += Math.random().toString(36).substring(2, 2 + length);
				}
				rand = rand.substring(0, length);
				return trySetVariable(this.getWorld().shared, { term, value: rand, domain: DOMAIN_STRING, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
			}
		},

		is: {
			gwta: 'variable {what} is {value}',
			action: ({ what, value }: { what: string, value: string }, featureStep: TFeatureStep) => {
				void what;
				let { term } = featureStep.action.stepValuesMap.what;
				const resolved = this.getWorld().shared.resolveVariable({ term, origin: Origin.defined });
				const storedVal = resolved.value; // Already coerced by resolveVariable

				// Coerce comparison value using the same domain
				const domainKey = normalizeDomainKey(resolved.domain);
				const compareVal = this.getWorld().domains[domainKey].coerce({ term: '_cmp', value, domain: domainKey, origin: Origin.quoted });

				return JSON.stringify(storedVal) === JSON.stringify(compareVal) ? OK : actionNotOK(`${term} is ${JSON.stringify(storedVal)}, not ${JSON.stringify(compareVal)}`);
			}
		},
		isLessThan: {
			gwta: 'variable {what} is less than {value}',
			precludes: ['VariablesStepper.is'],
			action: ({ what, value }: { what: string, value: string }, featureStep: TFeatureStep) => {
				const term = getStepTerm(featureStep, 'what') ?? what;
				return this.compareValues(featureStep, term, value, '<');
			}
		},
		isMoreThan: {
			gwta: 'variable {what} is more than {value}',
			precludes: ['VariablesStepper.is'],
			action: ({ what, value }: { what: string, value: string }, featureStep: TFeatureStep) => {
				const term = getStepTerm(featureStep, 'what') ?? what;
				return this.compareValues(featureStep, term, value, '>');
			}
		},
		exists: {
			gwta: 'variable {what: string} exists',
			action: ({ what }: TStepArgs, featureStep: TFeatureStep) => {
				const term = getStepTerm(featureStep, 'what');
				const resolved = this.getWorld().shared.resolveVariable({ term, origin: Origin.defined });

				return resolved && (resolved.origin === Origin.var || resolved.origin === Origin.env) ? OK : actionNotOK(`${what} not set`);
			}
		},
		showVar: {
			gwta: 'show var {what}',
			action: (_: TStepArgs, featureStep: TFeatureStep) => {
				const term = getStepTerm(featureStep, 'what');
				const stepValue = this.getWorld().shared.resolveVariable({ term, origin: Origin.defined });

				if (!stepValue.value) {
					this.getWorld().logger.info(`is undefined`);
				} else {
					const provenance = featureStep.action.stepValuesMap.what.provenance?.map((p, i) => ({ [i]: { in: p.in, seq: p.seq.join(','), when: p.when } }));
					this.getWorld().logger.info(`is ${JSON.stringify({ ...stepValue, provenance }, null, 2)}`);
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

	compareValues(featureStep: TFeatureStep, term: string, value: string, operator: string) {
		const stored = this.getWorld().shared.all()[term];
		if (!stored) {
			return actionNotOK(`${term} is not set`);
		}
		const domainKey = normalizeDomainKey(stored.domain);
		const domainEntry = this.getWorld().domains[domainKey];
		if (!domainEntry) {
			throw new Error(`No domain coercer found for domain "${domainKey}"`);
		}
		const left = domainEntry.coerce({ ...stored, domain: domainKey }, featureStep, this.steppers);

		let rightValue = value ?? getStepTerm(featureStep, 'value');

		if (typeof rightValue === 'string' && rightValue.startsWith('"') && rightValue.endsWith('"')) {
			rightValue = rightValue.slice(1, -1);
		}

		const right = domainEntry.coerce({ term: `${term}__comparison`, value: rightValue, domain: domainKey, origin: Origin.quoted }, featureStep, this.steppers);
		const comparison = compareDomainValues(domainEntry, left, right, stored.domain);
		if (operator === '>') {
			return comparison > 0 ? OK : actionNotOK(`${term} is ${JSON.stringify(left)}, not ${JSON.stringify(right)}`);
		}
		if (operator === '<') {
			return comparison < 0 ? OK : actionNotOK(`${term} is ${JSON.stringify(left)}, not ${JSON.stringify(right)}`);
		}
		return actionNotOK(`Unsupported operator: ${operator}`);
	}


	private registerSubdomainFromStatement(domain: string, superdomains: TFeatureStep[] | undefined, featureStep: TFeatureStep) {
		try {
			const fallback = getStepTerm(featureStep, 'superdomains') ?? featureStep.in;
			const superdomainNames = extractValuesFromFragments(superdomains, fallback);
			if (!superdomainNames.length) {
				throw new Error('Superdomain set must specify at least one superdomain');
			}
			const uniqueNames = Array.from(new Set(superdomainNames));
			const effectiveDomain = domain ?? getStepTerm(featureStep, 'domain');
			if (!effectiveDomain) return actionNotOK('Domain name must be provided');
			const domainKey = normalizeDomainKey(effectiveDomain);
			if (this.getWorld().domains[domainKey]) {
				return actionNotOK(`Domain "${domainKey}" already exists`);
			}
			const superdomainDefs: TRegisteredDomain[] = uniqueNames.map((name) => {
				const normalized = normalizeDomainKey(name);
				const registered = this.getWorld().domains[normalized];
				if (!registered) {
					throw new Error(`Superdomain "${name}" not registered`);
				}
				return registered;
			});
			const enumSources = superdomainDefs.filter((entry) => Array.isArray(entry.values) && entry.values.length);
			const uniqueValues = Array.from(new Set(enumSources.flatMap((entry) => entry.values!)));
			const description = `Values inherited from ${uniqueNames.join(', ')}`;
			if (enumSources.length === superdomainDefs.length && uniqueValues.length) {
				const definition = createEnumDomainDefinition({ name: domainKey, values: uniqueValues, description });
				registerDomains(this.getWorld(), [[definition]]);
				return OK;
			}
			const schemaList = superdomainDefs.map((entry) => entry.schema);
			if (!schemaList.length) {
				throw new Error('Superdomains did not expose any schema to derive from');
			}
			let mergedSchema = schemaList[0];
			for (let i = 1; i < schemaList.length; i++) {
				mergedSchema = z.union([mergedSchema, schemaList[i]]);
			}
			const definition: TDomainDefinition = {
				selectors: [domainKey],
				schema: mergedSchema,
				coerce: (proto) => mergedSchema.parse(proto.value),
				description,
			};
			registerDomains(this.getWorld(), [[definition]]);
			return OK;
		} catch (error) {
			return actionNotOK(error instanceof Error ? error.message : String(error));
		}
	}

	private registerValuesDomainFromStatement(domain: string, valueFragments: TFeatureStep[] | undefined, featureStep: TFeatureStep, options?: { ordered?: boolean; label?: string; description?: string }) {
		try {
			const values = extractValuesFromFragments(valueFragments, getStepTerm(featureStep, 'values') ?? featureStep.in);
			const effectiveDomain = domain ?? getStepTerm(featureStep, 'domain');
			if (!effectiveDomain) return actionNotOK('Domain name must be provided');
			const domainKey = normalizeDomainKey(effectiveDomain);
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

const compareDomainValues = (domain: { comparator?: (a: unknown, b: unknown) => number }, left: unknown, right: unknown, domainName: string): number => {
	if (domain.comparator) {
		return domain.comparator(left, right);
	}
	if (typeof left === 'number' && typeof right === 'number') {
		return left - right;
	}
	if (left instanceof Date && right instanceof Date) {
		return left.getTime() - right.getTime();
	}
	throw new Error(`Domain ${domainName} does not support magnitude comparison`);
};

const renderComparable = (value: unknown) => {
	if (value instanceof Date) {
		return value.toISOString();
	}
	return JSON.stringify(value);
};

// ======== Helpers ========

// Resolves undefined value to literal if it looks like a string
function resolveValueOrLiteral(valMap: { term: string; origin: TOrigin } | undefined, value: string | undefined): { value: string | undefined; error?: string } {
	if (valMap && valMap.origin === Origin.defined && value === undefined) {
		return isLiteralValue(valMap.term)
			? { value: String(valMap.term) }
			: { value: undefined, error: `Variable ${valMap.term} is not defined` };
	}
	return { value };
}

// Returns OK if "set empty" and variable exists
function shouldSkipEmpty(featureStep: TFeatureStep, term: string, shared: FeatureVariables): typeof OK | undefined {
	return (featureStep.in.includes('set empty ') && shared.get(term) !== undefined) ? OK : undefined;
}

// Wraps shared.set in try/catch
function trySetVariable(shared: FeatureVariables, opts: { term: string; value: TAnyFixme; domain: string; origin: TOrigin; readonly?: boolean }, provenance: TProvenanceIdentifier): TActionResult {
	try {
		shared.set({ term: String(opts.term), value: opts.value, domain: opts.domain, origin: opts.origin, readonly: opts.readonly }, provenance);
		return OK;
	} catch (e: unknown) {
		return actionNotOK((e as Error).message);
	}
}

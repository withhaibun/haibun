import { z } from 'zod';
import { TFeatureStep, TWorld, IStepperCycles, TStartScenario, TRegisteredDomain, TDomainDefinition } from '../lib/defs.js';
import { OK, TStepArgs, Origin, TProvenanceIdentifier, TOrigin, TActionResult } from '../schema/protocol.js';
import { TAnyFixme } from '../lib/fixme.js';
import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';
import { actionOK, actionNotOK, getStepTerm, isLiteralValue, formatCurrentSeqPath } from '../lib/util/index.js';
import { FeatureVariables } from '../lib/feature-variables.js';
import { DOMAIN_STATEMENT, DOMAIN_STRING, normalizeDomainKey, createEnumDomainDefinition, registerDomains } from '../lib/domain-types.js';

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
	steps = {
		defineOpenSet: {
			gwta: `set of {domain: string} as {superdomains: ${DOMAIN_STATEMENT}}`,
			handlesUndefined: ['domain'],
			action: ({ domain, superdomains }: { domain: string, superdomains: TFeatureStep[] }, featureStep: TFeatureStep) => this.registerSubdomainFromStatement(domain, superdomains, featureStep)
		},
		defineOrderedSet: {
			precludes: [`${VariablesStepper.name}.defineValuesSet`, `${VariablesStepper.name}.defineSet`],
			handlesUndefined: ['domain'],
			gwta: `ordered set of {domain: string} is {values:${DOMAIN_STATEMENT}}`,
			action: ({ domain, values }: { domain: string, values: TFeatureStep[] }, featureStep: TFeatureStep) => this.registerValuesDomainFromStatement(domain, values, featureStep, { ordered: true, label: 'ordered set' })
		},
		defineValuesSet: {
			gwta: `set of {domain: string} is {values:${DOMAIN_STATEMENT}}`,
			handlesUndefined: ['domain'],
			action: ({ domain, values }: { domain: string, values: TFeatureStep[] }, featureStep: TFeatureStep) => this.registerValuesDomainFromStatement(domain, values, featureStep, { ordered: false, label: 'set' })
		},
		statementSetValues: {
			expose: false,
			gwta: '\\[{items: string}\\]',
			action: () => OK,
		},
		composeAs: {
			gwta: 'compose {what} as {domain} with {template}',
			handlesUndefined: ['what', 'template'],
			precludes: [`${VariablesStepper.name}.compose`],
			action: ({ domain }: { domain: string }, featureStep: TFeatureStep) => {
				const { term } = featureStep.action.stepValuesMap.what;
				const templateVal = featureStep.action.stepValuesMap.template;
				if (!templateVal?.term) return actionNotOK('template not provided');

				const result = this.interpolateTemplate(templateVal.term, featureStep);
				if (result.error) return actionNotOK(result.error);

				return trySetVariable(this.getWorld().shared, { term: String(term), value: result.value, domain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
			}
		},
		compose: {
			gwta: 'compose {what} with {template}',
			handlesUndefined: ['what', 'template'],
			action: (_: TStepArgs, featureStep: TFeatureStep) => {
				const { term } = featureStep.action.stepValuesMap.what;
				const templateVal = featureStep.action.stepValuesMap.template;
				if (!templateVal?.term) return actionNotOK('template not provided');

				const result = this.interpolateTemplate(templateVal.term, featureStep);
				if (result.error) return actionNotOK(result.error);

				return trySetVariable(this.getWorld().shared, { term: String(term), value: result.value, domain: DOMAIN_STRING, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
			}
		},
		increment: {
			gwta: 'increment {what}',
			handlesUndefined: ['what'],
			action: (_: TStepArgs, featureStep: TFeatureStep) => {
				const { term: rawTerm, domain } = featureStep.action.stepValuesMap.what;
				const interpolated = this.interpolateTemplate(rawTerm, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated.value!;
				const resolved = this.getWorld().shared.resolveVariable({ term, origin: Origin.var, domain }, featureStep);
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
				this.getWorld().eventLogger.log(featureStep, 'info', `incremented ${term} to ${newNum}`, {
					variable: term,
					oldValue: presentVal,
					newValue: newNum,
					operation: 'increment'
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
				const displayVars = Object.fromEntries(Object.entries(this.getWorld().shared.all()).map(([k, v]) => [k, v.value]));
				this.getWorld().eventLogger.info(`vars: ${JSON.stringify(displayVars, null, 2)}`, { vars: displayVars });
				return actionOK();
			},
		},
		set: {
			gwta: 'set( empty)? {what: string} to {value: string}',
			handlesUndefined: ['what', 'value'],
			precludes: ['Haibun.prose'],
			action: (args: TStepArgs, featureStep: TFeatureStep) => {
				const { term: rawTerm, domain, origin } = featureStep.action.stepValuesMap.what;
				const parsedValue = this.getWorld().shared.resolveVariable(featureStep.action.stepValuesMap.value, featureStep);
				if (parsedValue.value === undefined) return actionNotOK(`Variable ${featureStep.action.stepValuesMap.value.term} not found`);
				const resolved = { value: String(parsedValue.value) };

				const interpolated = this.interpolateTemplate(rawTerm, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated.value!;

				const skip = shouldSkipEmpty(featureStep, term, this.getWorld().shared);
				if (skip) return skip;

				// Inherit domain from existing variable if not explicitly specified
				const existing = this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep);
				const effectiveDomain = (domain === DOMAIN_STRING && existing?.domain) ? existing.domain : (domain || DOMAIN_STRING);

				const result = trySetVariable(this.getWorld().shared, { term, value: resolved.value, domain: effectiveDomain, origin }, provenanceFromFeatureStep(featureStep));
				if (result.ok) {
					this.getWorld().eventLogger.log(featureStep, 'info', `set ${term} to ${resolved.value}`, {
						variable: term,
						newValue: resolved.value,
						domain: effectiveDomain,
						operation: 'set'
					});
				}
				return result;
			}
		},
		setAs: {
			gwta: 'set( empty)? {what} as {domain} to {value}',
			handlesUndefined: ['what', 'domain', 'value'],
			precludes: [`${VariablesStepper.name}.set`],
			action: ({ value, domain }: { value: string, domain: string }, featureStep: TFeatureStep) => {
				const readonly = !!featureStep.in.match(/ as read-only /);
				const { term: rawTerm, origin } = featureStep.action.stepValuesMap.what;
				const parsedValue = this.getWorld().shared.resolveVariable(featureStep.action.stepValuesMap.value, featureStep);
				if (parsedValue.value === undefined) return actionNotOK(`Variable ${featureStep.action.stepValuesMap.value.term} not found`);
				const resolved = { value: String(parsedValue.value) };

				const interpolated = this.interpolateTemplate(rawTerm, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated.value!;

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
			handlesUndefined: ['what'],
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
			handlesUndefined: ['what', 'value'],
			action: (args: TStepArgs, featureStep: TFeatureStep) => {
				const { term: rawTerm } = featureStep.action.stepValuesMap.what;
				const interpolated = this.interpolateTemplate(rawTerm, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated.value!;

				const resolved = this.getWorld().shared.resolveVariable({ term, origin: Origin.defined }, featureStep);
				if (resolved.value === undefined) {
					return actionNotOK(`${term} is not set`);
				}
				const storedVal = resolved.value;

				const parsedValue = this.getWorld().shared.resolveVariable(featureStep.action.stepValuesMap.value, featureStep);
				if (parsedValue.value === undefined) return actionNotOK(`Variable ${featureStep.action.stepValuesMap.value.term} not found`);
				const value = String(parsedValue.value);

				const domainKey = normalizeDomainKey(resolved.domain);
				const compareVal = this.getWorld().domains[domainKey].coerce({ term: '_cmp', value, domain: domainKey, origin: Origin.quoted }, featureStep, this.steppers);

				return JSON.stringify(storedVal) === JSON.stringify(compareVal) ? OK : actionNotOK(`${term} is ${JSON.stringify(storedVal)}, not ${JSON.stringify(compareVal)}`);
			}
		},
		isLessThan: {
			gwta: 'variable {what} is less than {value}',
			handlesUndefined: ['what', 'value'],
			precludes: ['VariablesStepper.is'],
			action: ({ what, value }: { what: string, value: string }, featureStep: TFeatureStep) => {
				const term = getStepTerm(featureStep, 'what') ?? what;
				return this.compareValues(featureStep, term, value, '<');
			}
		},
		isMoreThan: {
			gwta: 'variable {what} is more than {value}',
			handlesUndefined: ['what', 'value'],
			precludes: ['VariablesStepper.is'],
			action: ({ what, value }: { what: string, value: string }, featureStep: TFeatureStep) => {
				const term = getStepTerm(featureStep, 'what') ?? what;
				return this.compareValues(featureStep, term, value, '>');
			}
		},
		exists: {
			gwta: 'variable {what} exists',
			handlesUndefined: ['what'],
			action: ({ what }: TStepArgs, featureStep: TFeatureStep) => {
				const term = (getStepTerm(featureStep, 'what') ?? what) as string;
				const resolved = this.getWorld().shared.resolveVariable({ term, origin: Origin.defined }, featureStep);
				return resolved && (resolved.origin === Origin.var || resolved.origin === Origin.env) ? OK : actionNotOK(`${what} not set`);
			}
		},
		showVar: {
			gwta: 'show var {what}',
			handlesUndefined: ['what'],
			action: (_: TStepArgs, featureStep: TFeatureStep) => {
				const rawTerm = getStepTerm(featureStep, 'what');
				if (rawTerm === undefined) return actionNotOK('variable not provided');
				const interpolated = this.interpolateTemplate(rawTerm, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated.value!;

				const stepValue = this.getWorld().shared.resolveVariable({ term, origin: Origin.defined }, featureStep);

				if (stepValue.value === undefined) {
					this.getWorld().eventLogger.info(`${term} is undefined`);
				} else {
					const provenance = featureStep.action.stepValuesMap.what.provenance?.map((p, i) => ({ [i]: { in: p.in, seq: p.seq.join(','), when: p.when } }));
					this.getWorld().eventLogger.info(`${term} is ${JSON.stringify({ ...stepValue, provenance }, null, 2)}`, { variable: term, value: stepValue });
				}
				return actionOK();
			}
		},
		showDomains: {
			gwta: 'show domains',
			action: () => {
				const domains = this.getWorld().domains;
				const allVars = this.getWorld().shared.all();
				const summary: Record<string, TAnyFixme> = {};

				for (const [name, def] of Object.entries(domains)) {
					let members = 0;
					for (const variable of Object.values(allVars)) {
						if (variable.domain && normalizeDomainKey(variable.domain) === name) {
							members++;
						}
					}

					let type: string | string[] = 'schema';
					if (def.values) {
						type = def.values;
					} else if (def.description) {
						type = def.description;
					}

					summary[name] = {
						type,
						members,
						ordered: !!def.comparator
					};
				}
				this.getWorld().eventLogger.info(`Domains: ${JSON.stringify(summary, null, 2)}`, { domains: summary });
				return OK;
			}
		},
		showDomain: {
			gwta: 'show domain {name}',
			handlesUndefined: ['name'],
			action: (_: TStepArgs, featureStep: TFeatureStep) => {
				const name = getStepTerm(featureStep, 'name');
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
				this.getWorld().eventLogger.info(`Domain "${name}": ${JSON.stringify({ ...domain, members }, null, 2)}`, { domain: name, ...domain, members });
				return OK;
			}
		},
		// Membership check: value is in domain (enum or member values)
		// Handles quoted ("value"), braced ({var}), or bare (value) forms
		// fallback: true lets quantifiers take precedence when both match
		isIn: {
			match: /^(.+) is in ([a-zA-Z][a-zA-Z0-9 ]*)$/,
			fallback: true,
			action: (_: unknown, featureStep: TFeatureStep) => {
				const matchResult = featureStep.in.match(/^(.+) is in ([a-zA-Z][a-zA-Z0-9 ]*)$/);
				if (!matchResult) {
					return actionNotOK('Invalid "is in" syntax');
				}

				let valueTerm = matchResult[1].trim();
				// Strip quotes if present
				if ((valueTerm.startsWith('"') && valueTerm.endsWith('"')) ||
					(valueTerm.startsWith('`') && valueTerm.endsWith('`'))) {
					valueTerm = valueTerm.slice(1, -1);
				}
				// Strip braces if present and resolve variable
				if (valueTerm.startsWith('{') && valueTerm.endsWith('}')) {
					valueTerm = valueTerm.slice(1, -1);
				}
				// Try to resolve as variable, fall back to literal
				const resolved = this.getWorld().shared.resolveVariable({ term: valueTerm, origin: Origin.defined });
				const actualValue = resolved?.value !== undefined ? String(resolved.value) : valueTerm;

				const domainName = matchResult[2].trim();
				const domainKey = normalizeDomainKey(domainName);
				const domainDef = this.getWorld().domains[domainKey];

				if (!domainDef) {
					return actionNotOK(`Domain "${domainName}" is not defined`);
				}

				// Check enum values first
				if (Array.isArray(domainDef.values) && domainDef.values.includes(actualValue)) {
					return OK;
				}

				// Check member values
				const allVars = this.getWorld().shared.all();
				const memberValues = Object.values(allVars)
					.filter(v => v.domain && normalizeDomainKey(v.domain) === domainKey)
					.map(v => String(v.value));

				return memberValues.includes(actualValue)
					? OK
					: actionNotOK(`"${actualValue}" is not in ${domainName}`);
			}
		},
		// Pattern matching: glob-style patterns for human-readable matching
		// Usage: that {host} matches "*.wikipedia.org"
		//        that {path} matches "/api/*"
		//        that {name} matches "*test*"
		// Supports * as wildcard (matches any characters)
		// Variables in pattern are interpolated: "{counter URI}*" resolves to actual value
		matches: {
			gwta: 'that {value} matches {pattern}',
			action: ({ value, pattern }: { value: string; pattern: string }, featureStep: TFeatureStep) => {
				// Interpolate value (e.g. "{request}/url" -> "req-1/url")
				const interpolatedValue = this.interpolateTemplate(value, featureStep);
				if (interpolatedValue.error) return actionNotOK(interpolatedValue.error);
				const term = interpolatedValue.value!;

				// Resolve value as a variable (e.g., "WebPlaywright/currentURI" -> actual URL)
				const resolved = this.getWorld().shared.resolveVariable({ term, origin: Origin.defined }, featureStep);
				const actualValue = resolved.value !== undefined ? String(resolved.value) : String(term);

				// Interpolate variables in pattern (e.g., "{counter URI}*" -> "http://localhost:8123/*")
				const interpolated = this.interpolateTemplate(pattern, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const actualPattern = interpolated.value!;

				// Convert glob pattern to regex
				// Escape regex special chars except *, then replace * with .*
				const escaped = actualPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
				const regexPattern = escaped.replace(/\*/g, '.*');
				const regex = new RegExp(`^${regexPattern}$`);

				const isMatch = regex.test(actualValue);

				return isMatch
					? OK
					: actionNotOK(`"${actualValue}" does not match pattern "${actualPattern}"`);
			}
		},
	} satisfies TStepperSteps;

	readonly typedSteps = this.steps;

	compareValues(featureStep: TFeatureStep, rawTerm: string, value: string, operator: string) {
		const interpolated = this.interpolateTemplate(rawTerm, featureStep);
		if (interpolated.error) return actionNotOK(interpolated.error);
		const term = interpolated.value!;

		const stored = this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep);
		if (!stored) {
			return actionNotOK(`${term} is not set`);
		}
		const domainKey = normalizeDomainKey(stored.domain);
		const domainEntry = this.getWorld().domains[domainKey];
		if (!domainEntry) {
			throw new Error(`No domain coercer found for domain "${domainKey}"`);
		}
		const left = domainEntry.coerce({ ...stored, domain: domainKey }, featureStep, this.steppers);

		let rightValue = value;
		if (rightValue === undefined) {
			const parsed = this.getWorld().shared.resolveVariable(featureStep.action.stepValuesMap.value, featureStep);
			if (parsed.value === undefined) return actionNotOK(`Variable ${featureStep.action.stepValuesMap.value.term} not found`);
			rightValue = String(parsed.value);
		}

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

	/**
	 * Interpolates a template string by replacing {varName} placeholders with variable values.
	 * Returns the interpolated string or an error if a variable is not found.
	 */
	private interpolateTemplate(template: string, featureStep?: TFeatureStep): { value?: string; error?: string } {
		const placeholderRegex = /\{([^}]+)\}/g;
		let result = template;
		let match: RegExpExecArray | null;

		while ((match = placeholderRegex.exec(template)) !== null) {
			const varName = match[1];
			const resolved = this.getWorld().shared.resolveVariable({ term: varName, origin: Origin.defined }, featureStep);

			if (resolved.value === undefined) {
				return { error: `Variable ${varName} not found` };
			}
			result = result.replace(match[0], String(resolved.value));
		}

		return { value: result };
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

// ======== Helpers ========

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

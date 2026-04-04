import { z } from 'zod';
import { TFeatureStep, TWorld, IStepperCycles, TStartScenario, TRegisteredDomain, TDomainDefinition, LinkRelations } from '../lib/defs.js';
import { OK, TStepArgs, Origin, TProvenanceIdentifier, TOrigin, TActionResult } from '../schema/protocol.js';
import { TAnyFixme } from '../lib/fixme.js';
import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';
import { actionOK, actionNotOK, actionOKWithProducts, getStepTerm } from '../lib/util/index.js';
import { FlowRunner } from '../lib/core/flow-runner.js';
import { FeatureVariables, OBSCURED_VALUE } from '../lib/feature-variables.js';
import { sanitizeObjectSecrets } from '../lib/util/secret-utils.js';
import { DOMAIN_STATEMENT, DOMAIN_STRING, normalizeDomainKey, createEnumDomainDefinition, registerDomains } from '../lib/domain-types.js';
import type { IQuadStore } from '../lib/quad-types.js';

const AnnotationSchema = z.object({ id: z.string(), text: z.string(), author: z.string().optional(), timestamp: z.string() });
export const ANNOTATION_LABEL = "Annotation";
const ANNOTATION_DOMAIN = "annotation";
const QUAD_STORE_KEYS = ["muskeg-graph-store", "quad-store"] as const;

function findStore(runtime: Record<string, unknown>): IQuadStore | undefined {
	for (const key of QUAD_STORE_KEYS) { if (runtime[key]) return runtime[key] as IQuadStore; }
	return undefined;
}

const clearVars = (vars: VariablesStepper) => () => {
	vars.getWorld().shared.clear();
	return;
};

const cycles = (variablesStepper: VariablesStepper): IStepperCycles => ({
	getConcerns: () => ({
		domains: [{
			selectors: [ANNOTATION_DOMAIN],
			schema: AnnotationSchema,
			description: "Annotation",
			meta: {
				vertexLabel: ANNOTATION_LABEL, id: "id",
				properties: {
					id: LinkRelations.IDENTIFIER.rel,
					text: { rel: LinkRelations.CONTENT.rel, mediaType: "text/markdown" },
					author: LinkRelations.ATTRIBUTED_TO.rel,
					timestamp: LinkRelations.PUBLISHED.rel,
				},
				edges: { annotates: { rel: LinkRelations.IN_REPLY_TO.rel, target: "*" } },
			},
		} satisfies TDomainDefinition],
	}),
	startFeature: clearVars(variablesStepper),
	startScenario: ({ scopedVars }: TStartScenario) => {
		variablesStepper.getWorld().shared = new FeatureVariables(variablesStepper.getWorld(), { ...scopedVars.all() });
		return Promise.resolve();
	},
});

class VariablesStepper extends AStepper implements IHasCycles {
	description = 'Set, get, and compare variables; define domains and check membership';

	cycles = cycles(this);
	steppers: AStepper[];
	private runner!: FlowRunner;
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.world = world;
		this.steppers = steppers;
		this.runner = new FlowRunner(world, steppers);
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
			exposeMCP: false,
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

				return trySetVariable(this.getWorld().shared, { term: String(term), value: result.value, domain, origin: Origin.var, secret: result.secret }, provenanceFromFeatureStep(featureStep));
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

				return trySetVariable(this.getWorld().shared, { term: String(term), value: result.value, domain: DOMAIN_STRING, origin: Origin.var, secret: result.secret }, provenanceFromFeatureStep(featureStep));
			},
		},
		setFromStatement: {
			gwta: `set {what: string} from {statement: ${DOMAIN_STATEMENT}}`,
			handlesUndefined: ['what'],
			precludes: [`${VariablesStepper.name}.set`],
			action: async ({ statement }: { statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const { term } = featureStep.action.stepValuesMap.what;
				const result = await this.runner.runSteps(statement, { intent: { mode: 'authoritative' }, parentStep: featureStep });
				if (!result.ok) return actionNotOK(`set from statement failed: ${result.errorMessage}`);
				this.getWorld().shared.setJSON(String(term), result.products ?? {}, Origin.var, featureStep);
				return actionOK();
			},
		},
		increment: {
			gwta: 'increment {what}',
			handlesUndefined: ['what'],
			action: (_: TStepArgs, featureStep: TFeatureStep) => {
				const { term: rawTerm } = featureStep.action.stepValuesMap.what;
				const interpolated = this.interpolateTemplate(rawTerm, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated?.value;
				const resolved = this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep);
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
					this.getWorld().shared.set({ term: String(term), value: nextVal, domain: effectiveDomain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
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
			exposeMCP: false,
			action: () => {
				// Obscure secret environment variables (matching /password/i)
				const envVars = this.world.options.envVariables || {};
				const shared = this.getWorld().shared;
				const safeEnv = sanitizeObjectSecrets(envVars, (key) => shared.isSecret(key));
				this.getWorld().eventLogger.info(`env: ${JSON.stringify(safeEnv, null, 2)}`, { env: safeEnv });
				return Promise.resolve(OK);
			}
		},
		showVars: {
			gwta: 'show vars',
			action: () => {
				const shared = this.getWorld().shared;
				const displayVars = Object.fromEntries(
					Object.entries(shared.all()).map(([key, variable]) => [key, variable.value])
				);
					const safeVars = sanitizeObjectSecrets(displayVars, (key) => shared.isSecret(key));
				this.getWorld().eventLogger.info(`vars: ${JSON.stringify(safeVars, null, 2)}`, { vars: safeVars });
				return actionOK();
			},
		},
		set: {
			gwta: 'set( empty)? {what: string} to {value: string}',
			handlesUndefined: ['what', 'value'],
			precludes: ['Haibun.prose'],
			action: (args: TStepArgs, featureStep: TFeatureStep) => {
				const { term: rawTerm, domain, origin } = featureStep.action.stepValuesMap.what;
				const parsedValue = this.getWorld().shared.resolveVariable(featureStep.action.stepValuesMap.value, featureStep, undefined, { secure: true });
				if (parsedValue.value === undefined) return actionNotOK(`Variable ${featureStep.action.stepValuesMap.value.term} not found`);
				const resolved = { value: String(parsedValue.value) };

				const interpolated = this.interpolateTemplate(rawTerm, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated?.value;

				const skip = shouldSkipEmpty(featureStep, term, this.getWorld().shared);
				if (skip) return skip;

				// Inherit domain from existing variable if not explicitly specified
				const existing = this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep);
				const effectiveDomain = (domain === DOMAIN_STRING && existing?.domain) ? existing.domain : (domain || DOMAIN_STRING);

				const result = trySetVariable(this.getWorld().shared, { term, value: resolved.value, domain: effectiveDomain, origin, secret: interpolated.secret || parsedValue.secret }, provenanceFromFeatureStep(featureStep));
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
				const parsedValue = this.getWorld().shared.resolveVariable(featureStep.action.stepValuesMap.value, featureStep, undefined, { secure: true });
				if (parsedValue.value === undefined) return actionNotOK(`Variable ${featureStep.action.stepValuesMap.value.term} not found`);
				const resolved = { value: String(parsedValue.value) };

				const interpolated = this.interpolateTemplate(rawTerm, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated.value;

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
				return trySetVariable(this.getWorld().shared, { term, value: finalValue, domain: effectiveDomain, origin, readonly, secret: interpolated.secret || parsedValue.secret }, provenanceFromFeatureStep(featureStep));
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
			action: (_: TStepArgs, featureStep: TFeatureStep) => {
				const { term: rawTerm } = featureStep.action.stepValuesMap.what;
				const interpolated = this.interpolateTemplate(rawTerm, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated.value;

				const resolved = this.getWorld().shared.resolveVariable({ term, origin: Origin.defined }, featureStep, undefined, { secure: true });
				if (resolved.value === undefined || (resolved.origin !== Origin.var && resolved.origin !== Origin.env)) {
					return actionNotOK(`${term} is not set`);
				}

				const parsedValue = this.getWorld().shared.resolveVariable(featureStep.action.stepValuesMap.value, featureStep, undefined, { secure: true });
				if (parsedValue.value === undefined) return actionNotOK(`Variable ${featureStep.action.stepValuesMap.value.term} not found`);
				const value = String(parsedValue.value);

				const domainKey = normalizeDomainKey(resolved.domain);
				const compareVal = this.getWorld().domains[domainKey].coerce({ term: '_cmp', value, domain: domainKey, origin: Origin.quoted }, featureStep, this.steppers);

				return JSON.stringify(resolved.value) === JSON.stringify(compareVal) ? OK : actionNotOK(`${term} is ${JSON.stringify(resolved.value)}, not ${JSON.stringify(compareVal)}`);
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
				const sharedVars = this.getWorld().shared.all();
				if (sharedVars[term]) return OK;
				const envVars = this.getWorld().options.envVariables || {};
				return envVars[term] !== undefined ? OK : actionNotOK(`${what} not set`);
			}
		},
		showVar: {
			gwta: 'show var {what}',
			handlesUndefined: ['what'],
			outputSchema: z.object({ term: z.string(), value: z.unknown(), domain: z.string().optional() }),
			action: (_: TStepArgs, featureStep: TFeatureStep) => {
				const rawTerm = getStepTerm(featureStep, 'what');
				if (rawTerm === undefined) return actionNotOK('variable not provided');
				const interpolated = this.interpolateTemplate(rawTerm, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated.value || '';

				const shared = this.getWorld().shared;
				const stepValue = shared.resolveVariable({ term, origin: Origin.defined }, featureStep);
				const isSecret = shared.isSecret(term) || stepValue.secret === true;

				if (stepValue.value === undefined) {
					this.getWorld().eventLogger.info(`${term} is undefined`);
					return actionOKWithProducts({ term, value: undefined, domain: stepValue.domain });
				}
				const displayValue = isSecret ? { ...stepValue, value: OBSCURED_VALUE } : stepValue;
				const provenance = featureStep.action.stepValuesMap.what.provenance?.map((p, i) => ({ [i]: { in: p.in, seq: p.seq.join(','), when: p.when } }));
				this.getWorld().eventLogger.info(`${term} is ${JSON.stringify({ ...displayValue, provenance }, null, 2)}`, { variable: term, value: displayValue });
				return actionOKWithProducts({ term, value: stepValue.value, domain: stepValue.domain });
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
				const shared = this.getWorld().shared;
				const allVars = shared.all();
				const members: Record<string, TAnyFixme> = {};
				for (const [key, variable] of Object.entries(allVars)) {
					if (variable.domain && normalizeDomainKey(variable.domain) === name) {
						members[key] = shared.isSecret(key) ? OBSCURED_VALUE : variable.value;
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
				const resolvedValue = this.getWorld().shared.get(valueTerm, true);
				const actualValue = resolvedValue !== undefined ? String(resolvedValue) : valueTerm;

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
		// Usage: matches {host} with "*.wikipedia.org"
		//        matches {path} with "/api/*"
		//        matches {name} with "*test*"
		// Supports * as wildcard (matches any characters)
		// Variables in pattern are interpolated: "{counter URI}*" resolves to actual value
		matches: {
			gwta: 'matches {value} with {pattern}',
			action: ({ value, pattern }: { value: string; pattern: string }, featureStep: TFeatureStep) => {
				// Interpolate value (e.g. "{request}/url" -> "req-1/url")
				const interpolatedValue = this.interpolateTemplate(value, featureStep);
				if (interpolatedValue.error) return actionNotOK(interpolatedValue.error);
				const term = interpolatedValue.value;

				// Resolve value as a variable (e.g., "WebPlaywright/currentURI" -> actual URL)
				const resolvedValue = this.getWorld().shared.get(term, true);
				const actualValue = resolvedValue !== undefined ? String(resolvedValue) : String(term);

				// Interpolate variables in pattern (e.g., "{counter URI}*" -> "http://localhost:8123/*")
				const interpolated = this.interpolateTemplate(pattern, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const actualPattern = interpolated.value;

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
		// --- Annotations & Related ---
		annotate: {
			gwta: "annotate {label: string} {id: string} with {text: string}",
			outputSchema: z.object({ annotationId: z.string() }),
			action: async ({ label, id, text }: { label: string; id: string; text: string }) => {
				const store = findStore(this.getWorld().runtime);
				if (!store) return actionNotOK("No graph store available");
				const annotationId = crypto.randomUUID();
				await store.upsertVertex(ANNOTATION_LABEL, { id: annotationId, text, timestamp: new Date().toISOString() });
				// Determine context: inherit from target if it has one, otherwise target is the root
				const targetContext = store.query({ subject: id, predicate: LinkRelations.CONTEXT.rel });
				const contextRoot = targetContext.length > 0 ? String(targetContext[0].object) : id;
				store.add({ subject: annotationId, predicate: LinkRelations.IN_REPLY_TO.rel, object: id, namedGraph: label });
				store.add({ subject: annotationId, predicate: LinkRelations.CONTEXT.rel, object: contextRoot, namedGraph: ANNOTATION_LABEL });
				// Ensure the target also has a context quad (so getRelated finds it)
				if (targetContext.length === 0) {
					store.add({ subject: id, predicate: LinkRelations.CONTEXT.rel, object: id, namedGraph: label });
				}
				return actionOKWithProducts({ annotationId, contextRoot });
			},
		},
		getRelated: {
			gwta: "get related for {label: string} {id: string}",
			outputSchema: z.object({ items: z.array(z.unknown()), contextRoot: z.string() }),
			action: async ({ label, id }: { label: string; id: string }) => {
				const store = findStore(this.getWorld().runtime);
				if (!store) return actionNotOK("No graph store available");
				// Find context root for this vertex
				const contextQuads = store.query({ subject: id, predicate: LinkRelations.CONTEXT.rel });
				const contextRoot = contextQuads.length > 0 ? String(contextQuads[0].object) : id;
				// Get all items sharing this context
				const contextMembers = store.query({ predicate: LinkRelations.CONTEXT.rel, object: contextRoot });
				const ids = new Set([contextRoot, ...contextMembers.map((q) => String(q.subject))]);
				const items: Record<string, unknown>[] = [];
				for (const vid of ids) {
					const vertex = await store.getVertex(label, vid) ?? await store.getVertex(ANNOTATION_LABEL, vid);
					if (vertex) {
						const outgoing = store.query({ subject: vid });
						const edges = outgoing.filter((q) => q.predicate !== LinkRelations.CONTEXT.rel).map((q) => ({ type: q.predicate, targetId: String(q.object) }));
						const replyTo = edges.find((e) => e.type === LinkRelations.IN_REPLY_TO.rel);
						items.push({ ...(vertex as Record<string, unknown>), _id: vid, _inReplyTo: replyTo?.targetId, _edges: edges });
					}
				}
				items.sort((a, b) => {
					const dateA = String(a.timestamp ?? a.dateSent ?? a.published ?? "");
					const dateB = String(b.timestamp ?? b.dateSent ?? b.published ?? "");
					return dateA.localeCompare(dateB);
				});
				return actionOKWithProducts({ items, contextRoot });
			},
		},
	} satisfies TStepperSteps;

	readonly typedSteps = this.steps;

	compareValues(featureStep: TFeatureStep, rawTerm: string, value: string, operator: string) {
		const interpolated = this.interpolateTemplate(rawTerm, featureStep);
		if (interpolated.error) return actionNotOK(interpolated.error);
		const term = interpolated.value;

		const stored = this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep, this.steppers, { secure: true });
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
	private interpolateTemplate(template: string, featureStep?: TFeatureStep): { value?: string; error?: string; secret?: boolean } {
		const placeholderRegex = /\{([^}]+)\}/g;
		let result = template;
		let match: RegExpExecArray | null;
		let secret = false;

		while ((match = placeholderRegex.exec(template)) !== null) {
			const varName = match[1];
			// Check if it's secret BEFORE resolving it securely so we know
			if (this.getWorld().shared.isSecret(varName)) {
				secret = true;
			}
			const resolved = this.getWorld().shared.resolveVariable({ term: varName, origin: Origin.defined }, featureStep, undefined, { secure: true });

			if (resolved.value === undefined) {
				return { error: `Variable ${varName} not found` };
			}
			result = result.replace(match[0], String(resolved.value));
		}

		return { value: result, secret };
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
			const uniqueValues = Array.from(new Set(enumSources.flatMap((entry) => entry.values)));
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
	return (featureStep.in.includes('set empty ') && shared.resolveVariable({ term, origin: Origin.var }, featureStep, undefined, { secure: true }).value !== undefined) ? OK : undefined;
}

// Wraps shared.set in try/catch
function trySetVariable(shared: FeatureVariables, opts: { term: string; value: TAnyFixme; domain: string; origin: TOrigin; readonly?: boolean; secret?: boolean }, provenance: TProvenanceIdentifier): TActionResult {
	try {
		shared.set({ term: opts.term, value: opts.value, domain: opts.domain, origin: opts.origin, readonly: opts.readonly, secret: opts.secret }, provenance);
		return OK;
	} catch (e: unknown) {
		return actionNotOK((e as Error).message);
	}
}

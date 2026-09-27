import { z } from "zod";

import type { TWorld } from "../lib/world.js";
import { OK, Origin, TProvenanceIdentifier, TOrigin, TActionResult, TStepValue } from "../schema/protocol.js";
import { TAnyFixme } from "../lib/fixme.js";
import { AStepper, IHasCycles, TStepperSteps, TFeatureStep, IStepperCycles, TStartScenario } from "../lib/astepper.js";
import { actionOK, actionNotOK, actionOKWithProducts, getStepTerm, errorDetail } from "../lib/util/index.js";
import { FlowRunner } from "../lib/core/flow-runner.js";
import { FeatureVariables, OBSCURED_VALUE } from "../lib/feature-variables.js";
import { sanitizeObjectSecrets } from "../lib/util/secret-utils.js";
import {
	DOMAIN_DOMAIN_KEY,
	DOMAIN_DOMAIN_NAME,
	DOMAIN_GLOB,
	DOMAIN_STATEMENT,
	DOMAIN_STRING,
	DOMAIN_VARIABLE_NAME,
	DOMAIN_VARIABLE_VALUE,
	DOMAIN_TEMPLATE,
	DOMAIN_HYPERMEDIA_DECLARATION,
	DOMAIN_SET_VALUES,
	parseQuotedOrWordList,
	normalizeDomainKey,
	createEnumDomainDefinition,
	globSource,
	registerDomains,
} from "../lib/domains.js";
import { fromJsonText } from "../lib/json-text.js";
import { HypermediaContextSchema, hypermediaDomainFromContext, type THypermediaContext } from "../lib/hypermedia.js";
import { edgeRanges, isPersisted, REL_CONTEXT, LinkRelations, type TRel, type TRegisteredDomain, type TDomainDefinition } from "../lib/resources.js";

const clearVars = (vars: VariablesStepper) => async () => {
	await vars.getWorld().shared.getStore().clear();
};

const DOMAIN_ENV_SNAPSHOT = "env-snapshot";
const DOMAIN_VARS_SNAPSHOT = "vars-snapshot";
const DOMAIN_VAR_SNAPSHOT = "var-snapshot";
const DOMAIN_DOMAINS_SNAPSHOT = "domains-snapshot";
const DOMAIN_DOMAIN_SNAPSHOT = "domain-snapshot";

const EnvSnapshotSchema = z.object({ env: z.record(z.string(), z.string()) });
const VarsSnapshotSchema = z.object({ vars: z.record(z.string(), z.unknown()) });
const VarSnapshotSchema = z.object({ term: z.string(), value: z.unknown(), domain: z.string().optional(), secret: z.boolean().optional() });
const DomainEdgeSchema = z.object({ type: z.string(), targetId: z.string() });
const DomainsSnapshotSchema = z.object({
	items: z.array(
		z.object({
			name: z.string(),
			description: z.string(),
			values: z.array(z.string()).optional(),
			members: z.number(),
			persistedAs: z.string().optional(),
			_edges: z.array(DomainEdgeSchema).optional(),
		}),
	),
});
const DomainSnapshotSchema = z.object({
	domain: z.string(),
	description: z.string(),
	values: z.array(z.string()).optional(),
	stepperName: z.string().optional(),
	topology: z.record(z.string(), z.unknown()).optional(),
	members: z.record(z.string(), z.unknown()),
});

const envSummary = (p: Record<string, unknown>) => {
	const env = p.env as Record<string, string> | undefined;
	const count = env ? Object.keys(env).length : 0;
	return `${count} environment variable${count === 1 ? "" : "s"}`;
};

const varsSummary = (p: Record<string, unknown>) => {
	const vars = p.vars as Record<string, unknown> | undefined;
	const count = vars ? Object.keys(vars).length : 0;
	return `${count} variable${count === 1 ? "" : "s"}`;
};

const varSummary = (p: Record<string, unknown>) => {
	const term = String(p.term ?? "");
	const display = p.secret ? OBSCURED_VALUE : typeof p.value === "object" ? JSON.stringify(p.value) : String(p.value);
	return `${term} = ${display}`;
};

const domainsSummary = (p: Record<string, unknown>) => `${(p.items as unknown[]).length} domains`;
const domainSummary = (p: Record<string, unknown>) => `${String(p.domain)}: ${Object.keys(p.members as Record<string, unknown>).length} members`;

const cycles = (variablesStepper: VariablesStepper): IStepperCycles => ({
	startFeature: clearVars(variablesStepper),
	startScenario: async ({ scopedVars }: TStartScenario) => {
		variablesStepper.getWorld().shared = new FeatureVariables(variablesStepper.getWorld(), { ...(await scopedVars.all()) });
	},
	getConcerns: () => ({
		domains: [
			{ selectors: [DOMAIN_ENV_SNAPSHOT], schema: EnvSnapshotSchema, description: "Snapshot of environment variables", ui: { summary: envSummary } },
			{ selectors: [DOMAIN_VARS_SNAPSHOT], schema: VarsSnapshotSchema, description: "Snapshot of feature variables", ui: { summary: varsSummary } },
			{ selectors: [DOMAIN_VAR_SNAPSHOT], schema: VarSnapshotSchema, description: "Snapshot of a single variable", ui: { summary: varSummary } },
			{ selectors: [DOMAIN_DOMAINS_SNAPSHOT], schema: DomainsSnapshotSchema, description: "Snapshot of every registered domain", ui: { summary: domainsSummary } },
			{ selectors: [DOMAIN_DOMAIN_SNAPSHOT], schema: DomainSnapshotSchema, description: "Snapshot of a registered domain and its members", ui: { summary: domainSummary } },
		],
	}),
});

class VariablesStepper extends AStepper implements IHasCycles {
	description = "Set, get, and compare variables; define domains and check membership";

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
			gwta: `set of {domain: ${DOMAIN_DOMAIN_NAME}} as {superdomains: ${DOMAIN_STATEMENT}}`,
			action: ({ domain, superdomains }: { domain: string; superdomains: TFeatureStep[] }, featureStep: TFeatureStep) =>
				this.registerSubdomainFromStatement(domain, superdomains, featureStep),
		},
		defineOrderedSet: {
			precludes: [`${VariablesStepper.name}.defineValuesSet`, `${VariablesStepper.name}.defineSet`],
			gwta: `ordered set of {domain: ${DOMAIN_DOMAIN_NAME}} is {values:${DOMAIN_STATEMENT}}`,
			action: ({ domain, values }: { domain: string; values: TFeatureStep[] }, featureStep: TFeatureStep) =>
				this.registerValuesDomainFromStatement(domain, values, featureStep, { ordered: true, label: "ordered set" }),
		},
		defineValuesSet: {
			gwta: `set of {domain: ${DOMAIN_DOMAIN_NAME}} is {values:${DOMAIN_STATEMENT}}`,
			action: ({ domain, values }: { domain: string; values: TFeatureStep[] }, featureStep: TFeatureStep) =>
				this.registerValuesDomainFromStatement(domain, values, featureStep, { ordered: false, label: "set" }),
		},
		// Declare a persisted hypermedia domain (a domain carrying a hypermedia topology) from a JSON-LD
		// @context or its prose shorthand. `by` is the direction word (not `from`, which means "from a
		// statement's result").
		defineHypermediaDomain: {
			gwta: `set of {domain: ${DOMAIN_DOMAIN_NAME}} by {spec: ${DOMAIN_HYPERMEDIA_DECLARATION}}`,
			action: ({ domain, spec }: { domain: string; spec: string }) => this.registerHypermediaDomain(domain, spec),
		},
		statementSetValues: {
			gwta: `\\[{items: ${DOMAIN_SET_VALUES}}\\]`,
			action: () => OK,
		},
		composeAs: {
			gwta: `compose {what: ${DOMAIN_VARIABLE_NAME}} as {domain: ${DOMAIN_DOMAIN_KEY}} with {template: ${DOMAIN_TEMPLATE}}`,
			precludes: [`${VariablesStepper.name}.compose`],
			action: async ({ what, domain, template }: { what: string; domain: string; template: string }, featureStep: TFeatureStep) => {
				const result = await this.interpolateTemplate(template, featureStep);
				if (result.error) return actionNotOK(result.error);

				return trySetVariable(
					this.getWorld().shared,
					{ term: what, value: result.value, domain, origin: Origin.var, secret: result.secret },
					provenanceFromFeatureStep(featureStep),
				);
			},
		},
		compose: {
			gwta: `compose {what: ${DOMAIN_VARIABLE_NAME}} with {template: ${DOMAIN_TEMPLATE}}`,
			action: async ({ what, template }: { what: string; template: string }, featureStep: TFeatureStep) => {
				const result = await this.interpolateTemplate(template, featureStep);
				if (result.error) return actionNotOK(result.error);

				return trySetVariable(
					this.getWorld().shared,
					{ term: what, value: result.value, domain: DOMAIN_STRING, origin: Origin.var, secret: result.secret },
					provenanceFromFeatureStep(featureStep),
				);
			},
		},
		setFromStatement: {
			gwta: `set {what: ${DOMAIN_VARIABLE_NAME}} from {statement: ${DOMAIN_STATEMENT}}`,
			precludes: [`${VariablesStepper.name}.set`],
			action: async ({ what, statement }: { what: string; statement: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const result = await this.runner.runSteps(statement, { intent: { mode: "authoritative" }, parentStep: featureStep });
				if (!result.ok) return actionNotOK(`set from statement failed: ${result.errorMessage}`);
				await this.getWorld().shared.setJSON(what, result.products ?? {}, Origin.var, featureStep);
				return actionOK();
			},
		},
		increment: {
			gwta: `increment {what: ${DOMAIN_VARIABLE_NAME}}`,
			action: async ({ what }: { what: string }, featureStep: TFeatureStep) => {
				const interpolated = await this.interpolateTemplate(what, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated?.value;
				const resolved = await this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep);
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
					await this.getWorld().shared.set({ term: String(term), value: nextVal, domain: effectiveDomain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
					return OK;
				}

				// Fallback: numeric increment
				const numVal = Number(presentVal);
				if (isNaN(numVal)) {
					return actionNotOK(`cannot increment non-numeric variable ${term} with value "${presentVal}"`);
				}
				const newNum = numVal + 1;
				await this.getWorld().shared.set({ term: String(term), value: String(newNum), domain: effectiveDomain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				this.getWorld().eventLogger.log(featureStep, "info", `incremented ${term} to ${newNum}`, {
					variable: term,
					oldValue: presentVal,
					newValue: newNum,
					operation: "increment",
				});
				return OK;
			},
		},
		showEnv: {
			gwta: "show env",
			productsDomain: DOMAIN_ENV_SNAPSHOT,
			action: () => {
				const envVars = this.world.options.envVariables || {};
				const shared = this.getWorld().shared;
				const safeEnv = sanitizeObjectSecrets(envVars, (key) => shared.isSecret(key));
				return actionOKWithProducts({ env: safeEnv });
			},
		},
		showVars: {
			gwta: "show vars",
			productsDomain: DOMAIN_VARS_SNAPSHOT,
			action: async () => {
				const shared = this.getWorld().shared;
				const displayVars = Object.fromEntries(Object.entries(await shared.all()).map(([key, variable]) => [key, variable.value]));
				const safeVars = sanitizeObjectSecrets(displayVars, (key) => shared.isSecret(key));
				return actionOKWithProducts({ vars: safeVars });
			},
		},
		set: {
			gwta: `set( empty)? {what: ${DOMAIN_VARIABLE_NAME}} to {value: ${DOMAIN_VARIABLE_VALUE}}`,
			precludes: ["Haibun.prose"],
			action: async ({ what, value }: { what: string; value: TStepValue }, featureStep: TFeatureStep) => {
				const interpolated = await this.interpolateTemplate(what, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated?.value;

				const skip = await shouldSkipEmpty(featureStep, term, this.getWorld().shared);
				if (skip) return skip;

				// A variable set again keeps its domain.
				const existing = await this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep);
				const result = trySetVariable(
					this.getWorld().shared,
					{ term, value: String(value.value), domain: existing?.domain ?? DOMAIN_STRING, origin: Origin.var, secret: interpolated.secret || value.secret },
					provenanceFromFeatureStep(featureStep),
				);
				return result;
			},
		},
		setAs: {
			gwta: `set( empty)? {what: ${DOMAIN_VARIABLE_NAME}} as( read-only)? {domain: ${DOMAIN_DOMAIN_KEY}} to {value: ${DOMAIN_VARIABLE_VALUE}}`,
			precludes: [`${VariablesStepper.name}.set`],
			action: async ({ what, domain, value }: { what: string; domain: string; value: TStepValue }, featureStep: TFeatureStep) => {
				const readonly = !!featureStep.in.match(/ as read-only /);

				const interpolated = await this.interpolateTemplate(what, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated.value;

				const skip = await shouldSkipEmpty(featureStep, term, this.getWorld().shared);
				if (skip) return skip;

				return trySetVariable(
					this.getWorld().shared,
					{ term, value: String(value.value), domain, origin: Origin.var, readonly, secret: interpolated.secret || value.secret },
					provenanceFromFeatureStep(featureStep),
				);
			},
		},
		unset: {
			gwta: `unset {what: ${DOMAIN_VARIABLE_NAME}}`,
			action: async ({ what }: { what: string }) => {
				await this.getWorld().shared.unset(what);
				return OK;
			},
		},
		setRandom: {
			precludes: [`${VariablesStepper.name}.set`],
			gwta: `set( empty)? {what: ${DOMAIN_VARIABLE_NAME}} to {length: number} random characters`,
			action: async ({ what: term, length }: { what: string; length: number }, featureStep: TFeatureStep) => {
				if (length < 1 || length > 100) {
					return actionNotOK(`length ${length} must be between 1 and 100`);
				}

				const skip = await shouldSkipEmpty(featureStep, term, this.getWorld().shared);
				if (skip) return skip;

				let rand = "";
				while (rand.length < length) {
					rand += Math.random()
						.toString(36)
						.substring(2, 2 + length);
				}
				rand = rand.substring(0, length);
				return trySetVariable(this.getWorld().shared, { term, value: rand, domain: DOMAIN_STRING, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
			},
		},

		is: {
			gwta: `variable {what: ${DOMAIN_VARIABLE_NAME}} is {value: ${DOMAIN_VARIABLE_VALUE}}`,
			action: async ({ what, value }: { what: string; value: TStepValue }, featureStep: TFeatureStep) => {
				const interpolated = await this.interpolateTemplate(what, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated.value;

				const resolved = await this.getWorld().shared.resolveVariable({ term, origin: Origin.defined }, featureStep, undefined, {
					secure: true,
				});
				if (resolved.value === undefined || (resolved.origin !== Origin.var && resolved.origin !== Origin.env)) {
					return actionNotOK(`${term} is not set`);
				}

				const domainKey = normalizeDomainKey(resolved.domain);
				const compareVal = this.getWorld().domains[domainKey].coerce(
					{ term: "_cmp", value: String(value.value), domain: domainKey, origin: Origin.quoted },
					featureStep,
					this.steppers,
				);

				return JSON.stringify(resolved.value) === JSON.stringify(compareVal) ? OK : actionNotOK(`${term} is ${JSON.stringify(resolved.value)}, not ${JSON.stringify(compareVal)}`);
			},
		},
		isLessThan: {
			gwta: `variable {what: ${DOMAIN_VARIABLE_NAME}} is less than {value: ${DOMAIN_VARIABLE_VALUE}}`,
			precludes: ["VariablesStepper.is"],
			action: ({ what, value }: { what: string; value: TStepValue }, featureStep: TFeatureStep) => {
				return this.compareValues(featureStep, what, value, "<");
			},
		},
		isMoreThan: {
			gwta: `variable {what: ${DOMAIN_VARIABLE_NAME}} is more than {value: ${DOMAIN_VARIABLE_VALUE}}`,
			precludes: ["VariablesStepper.is"],
			action: ({ what, value }: { what: string; value: TStepValue }, featureStep: TFeatureStep) => {
				return this.compareValues(featureStep, what, value, ">");
			},
		},
		exists: {
			gwta: `variable {what: ${DOMAIN_VARIABLE_NAME}} exists`,
			action: async ({ what: term }: { what: string }, featureStep: TFeatureStep) => {
				// Dot-path aware: matches the resolution used by `matches`, `show var`, and
				// every other variable-consuming step. Without this, `variable
				// foo.bar exists` fails even when `foo` is a JSON-stored object whose
				// `bar` key is defined, contradicting the rest of the variables-stepper.
				const resolved = await this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep);
				if (resolved.value !== undefined) return OK;
				const envVars = this.getWorld().options.envVariables || {};
				return envVars[term] !== undefined ? OK : actionNotOK(`${term} not set`);
			},
		},
		showVar: {
			gwta: `show var {what: ${DOMAIN_VARIABLE_NAME}}`,
			productsDomain: DOMAIN_VAR_SNAPSHOT,
			action: async ({ what }: { what: string }, featureStep: TFeatureStep) => {
				const interpolated = await this.interpolateTemplate(what, featureStep);
				if (interpolated.error) return actionNotOK(interpolated.error);
				const term = interpolated.value || "";

				const shared = this.getWorld().shared;
				const stepValue = await shared.resolveVariable({ term, origin: Origin.defined }, featureStep);
				const isSecret = shared.isSecret(term) || stepValue.secret === true;

				if (stepValue.value === undefined) {
					this.getWorld().eventLogger.info(`${term} is undefined`);
					return actionOKWithProducts({ term, value: undefined, domain: stepValue.domain });
				}
				return actionOKWithProducts({ term, value: stepValue.value, domain: stepValue.domain, secret: isSecret });
			},
		},
		showDomains: {
			gwta: "show domains",
			productsDomain: DOMAIN_DOMAINS_SNAPSHOT,
			action: async () => {
				const members = new Map<string, number>();
				for (const { domain } of Object.values(await this.getWorld().shared.all())) {
					const key = domain && normalizeDomainKey(domain);
					if (key) members.set(key, (members.get(key) ?? 0) + 1);
				}
				const items = Object.entries(this.getWorld().domains).map(([name, { description, values, topology }]) => {
					const persistedAs = isPersisted(topology) ? topology.persistedAs : undefined;
					// Edges from topology (persisted-type→persisted-type relationships like Email→Contact)
					const _edges = Object.entries((isPersisted(topology) && topology.edges) || {}).flatMap(([type, edge]) =>
						edgeRanges(edge)
							.filter((range) => range !== persistedAs)
							.map((targetId) => ({ type, targetId })),
					);
					return {
						name,
						description,
						...(values ? { values } : {}),
						members: members.get(name) ?? 0,
						...(persistedAs ? { persistedAs } : {}),
						...(_edges.length ? { _edges } : {}),
					};
				});
				return actionOKWithProducts({ items });
			},
		},
		showDomain: {
			gwta: `show domain {name: ${DOMAIN_DOMAIN_KEY}}`,
			productsDomain: DOMAIN_DOMAIN_SNAPSHOT,
			action: async ({ name }: { name: string }) => {
				const domain = this.getWorld().domains[name];
				if (!domain) {
					return actionNotOK(`Domain "${name}" not found`);
				}
				const shared = this.getWorld().shared;
				const members: Record<string, TAnyFixme> = {};
				for (const [key, variable] of Object.entries(await shared.all())) {
					if (variable.domain && normalizeDomainKey(variable.domain) === name) members[key] = shared.isSecret(key) ? OBSCURED_VALUE : variable.value;
				}
				const { description, values, stepperName, topology } = domain;
				return actionOKWithProducts({
					domain: name,
					description,
					...(values ? { values } : {}),
					...(stepperName ? { stepperName } : {}),
					...(topology ? { topology } : {}),
					members,
				});
			},
		},
		// Membership check: value is in domain (enum or member values)
		// Handles quoted ("value"), braced ({var}), or bare (value) forms
		// fallback: true lets quantifiers (every/some) win on the full line; precludes Haibun.prose
		// so the inner membership statement still resolves to a real step, not the catch-all narrative.
		isIn: {
			match: /^(.+) is in ([a-zA-Z][a-zA-Z0-9 ]*)$/,
			fallback: true,
			precludes: ["Haibun.prose"],
			action: async (_: unknown, featureStep: TFeatureStep) => {
				const matchResult = featureStep.in.match(/^(.+) is in ([a-zA-Z][a-zA-Z0-9 ]*)$/);
				if (!matchResult) {
					return actionNotOK('Invalid "is in" syntax');
				}

				let valueTerm = matchResult[1].trim();
				// Strip quotes if present
				if ((valueTerm.startsWith('"') && valueTerm.endsWith('"')) || (valueTerm.startsWith("`") && valueTerm.endsWith("`"))) {
					valueTerm = valueTerm.slice(1, -1);
				}
				// Strip braces if present and resolve variable
				if (valueTerm.startsWith("{") && valueTerm.endsWith("}")) {
					valueTerm = valueTerm.slice(1, -1);
				}
				// Try to resolve as variable, fall back to literal
				const resolvedValue = await this.getWorld().shared.get(valueTerm, true);
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
				const allVars = await this.getWorld().shared.all();
				const memberValues = Object.values(allVars)
					.filter((v) => v.domain && normalizeDomainKey(v.domain) === domainKey)
					.map((v) => String(v.value));

				return memberValues.includes(actualValue) ? OK : actionNotOK(`"${actualValue}" is not in ${domainName}`);
			},
		},
		// Pattern matching: glob-style patterns for human-readable matching
		// Usage: matches {host} with "*.wikipedia.org"
		//        matches {path} with "/api/*"
		//        matches {name} with "*test*"
		// Supports * as wildcard (matches any characters)
		// Variables in pattern are interpolated: "{counter URI}*" resolves to actual value
		matches: {
			gwta: `matches {value: ${DOMAIN_VARIABLE_VALUE}} with {pattern: ${DOMAIN_GLOB}}`,
			action: async ({ value, pattern }: { value: TStepValue; pattern: string }, featureStep: TFeatureStep) => {
				// value/pattern are text being compared: an unresolved {X} is literal data (e.g. a captured reply echoing
				// "{StepperName}"), not a variable reference, so interpolate leniently and leave unknown braces in place.
				const interpolatedValue = await this.interpolateTemplate(String(value.value), featureStep, { lenient: true });
				if (interpolatedValue.error) return actionNotOK(interpolatedValue.error);
				const actualValue = String(interpolatedValue.value);

				// Interpolate variables in pattern (e.g., "{counter URI}*" -> "http://localhost:8123/*")
				const interpolated = await this.interpolateTemplate(pattern, featureStep, { lenient: true });
				if (interpolated.error) return actionNotOK(interpolated.error);
				const actualPattern = interpolated.value;

				const isMatch = new RegExp(globSource(actualPattern), "s").test(actualValue);

				return isMatch ? OK : actionNotOK(`"${actualValue}" does not match pattern "${actualPattern}"`);
			},
		},
	} satisfies TStepperSteps;

	readonly typedSteps = this.steps;

	async compareValues(featureStep: TFeatureStep, rawTerm: string, value: TStepValue, operator: string) {
		const interpolated = await this.interpolateTemplate(rawTerm, featureStep);
		if (interpolated.error) return actionNotOK(interpolated.error);
		const term = interpolated.value;

		const stored = await this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep, this.steppers, {
			secure: true,
		});
		if (!stored) {
			return actionNotOK(`${term} is not set`);
		}
		const domainKey = normalizeDomainKey(stored.domain);
		const domainEntry = this.getWorld().domains[domainKey];
		if (!domainEntry) {
			throw new Error(`No domain coercer found for domain "${domainKey}"`);
		}
		const left = domainEntry.coerce({ ...stored, domain: domainKey }, featureStep, this.steppers);

		const right = domainEntry.coerce({ term: `${term}__comparison`, value: String(value.value), domain: domainKey, origin: Origin.quoted }, featureStep, this.steppers);
		const comparison = compareDomainValues(domainEntry, left, right, stored.domain);
		if (operator === ">") {
			return comparison > 0 ? OK : actionNotOK(`${term} is ${JSON.stringify(left)}, not ${JSON.stringify(right)}`);
		}
		if (operator === "<") {
			return comparison < 0 ? OK : actionNotOK(`${term} is ${JSON.stringify(left)}, not ${JSON.stringify(right)}`);
		}
		return actionNotOK(`Unsupported operator: ${operator}`);
	}

	/** Replaces {varName} placeholders with variable values; errors if a variable is not found. Value XOR error: a
	 *  missing template (an empty step argument reaches here untyped) is an error naming the situation, never an
	 *  undefined value a caller could interpolate into a nameless message. */
	private async interpolateTemplate(
		template: string | undefined,
		featureStep?: TFeatureStep,
		options?: { lenient?: boolean },
	): Promise<{ value?: string; error?: string; secret?: boolean }> {
		if (template === undefined) return { error: "no variable name to resolve: the step received an empty term" };
		const placeholderRegex = /\{([^}]+)\}/g;
		let result = template;
		let match: RegExpExecArray | null;
		let secret = false;

		while ((match = placeholderRegex.exec(template)) !== null) {
			const varName = match[1];
			// Determine secrecy before secure resolution masks the value.
			if (this.getWorld().shared.isSecret(varName)) {
				secret = true;
			}
			const resolved = await this.getWorld().shared.resolveVariable({ term: varName, origin: Origin.defined }, featureStep, undefined, {
				secure: true,
			});

			if (resolved.value === undefined) {
				// Lenient callers (text-matching) treat an unresolved {X} as literal data and leave it in place.
				if (options?.lenient) continue;
				return { error: `Variable ${varName} not found` };
			}
			result = result.replace(match[0], String(resolved.value));
		}

		return { value: result, secret };
	}

	private registerSubdomainFromStatement(domain: string, superdomains: TFeatureStep[] | undefined, featureStep: TFeatureStep) {
		try {
			const fallback = getStepTerm(featureStep, "superdomains") ?? featureStep.in;
			const superdomainNames = extractValuesFromFragments(superdomains, fallback);
			if (!superdomainNames.length) {
				throw new Error("Superdomain set must specify at least one superdomain");
			}
			const uniqueNames = Array.from(new Set(superdomainNames));
			const domainKey = normalizeDomainKey(domain);
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
			const description = `Values inherited from ${uniqueNames.join(", ")}`;
			if (enumSources.length === superdomainDefs.length && uniqueValues.length) {
				const definition = createEnumDomainDefinition({ name: domainKey, values: uniqueValues, description });
				registerDomains(this.getWorld(), [[definition]]);
				return OK;
			}
			const schemaList = superdomainDefs.map((entry) => entry.schema);
			if (!schemaList.length) {
				throw new Error("Superdomains did not expose any schema to derive from");
			}
			let mergedSchema = schemaList[0];
			for (let i = 1; i < schemaList.length; i++) {
				mergedSchema = z.union([mergedSchema, schemaList[i]]);
			}
			const definition: TDomainDefinition = {
				selectors: [domainKey],
				schema: mergedSchema,
				description,
			};
			registerDomains(this.getWorld(), [[definition]]);
			return OK;
		} catch (error) {
			return actionNotOK(errorDetail(error));
		}
	}

	private registerValuesDomainFromStatement(
		domain: string,
		valueFragments: TFeatureStep[] | undefined,
		featureStep: TFeatureStep,
		options?: { ordered?: boolean; label?: string; description?: string },
	) {
		try {
			const values = extractValuesFromFragments(valueFragments, getStepTerm(featureStep, "values") ?? featureStep.in);
			const domainKey = normalizeDomainKey(domain);
			if (this.getWorld().domains[domainKey]) {
				return actionNotOK(`Domain "${domainKey}" already exists`);
			}
			const definition = createEnumDomainDefinition({
				name: domainKey,
				values,
				description: options?.description,
				ordered: options?.ordered,
			});
			registerDomains(this.getWorld(), [[definition]]);
			return OK;
		} catch (error) {
			return actionNotOK(errorDetail(error));
		}
	}

	private registerHypermediaDomain(domain: string, spec: string) {
		try {
			const doc: THypermediaContext = spec.startsWith("{") ? fromJsonText(HypermediaContextSchema).parse(spec) : parseHypermediaDeclProse(domain, spec);
			const { topology, schema } = hypermediaDomainFromContext(domain, doc);
			const selector = domain.toLowerCase();
			const domainKey = normalizeDomainKey(selector);
			if (this.getWorld().domains[domainKey]) return actionNotOK(`Domain "${domainKey}" already exists`);
			registerDomains(this.getWorld(), [[{ selectors: [selector], schema: fromJsonText(schema), description: domain, topology, ui: { declared: true } }]]);
			return OK;
		} catch (error) {
			return actionNotOK(errorDetail(error));
		}
	}
}

export default VariablesStepper;

const XSD_FOR: Record<string, string> = {
	number: "xsd:integer",
	integer: "xsd:integer",
	decimal: "xsd:decimal",
	boolean: "xsd:boolean",
	date: "xsd:date",
	datetime: "xsd:dateTime",
	string: "",
};

/** Prose shorthand → JSON-LD @context: `id, with name [as number], used in Recipe`. The first clause is
 * the id field; `with {field}` maps the field to its same-named relation (queryable); `used in {Range}`
 * is the usedIn (isPartOf) edge. Non-relation field names need the JSON-LD form with an explicit @id. */
function parseHypermediaDeclProse(domain: string, spec: string): THypermediaContext {
	const clauses = spec
		.split(",")
		.map((c) => c.trim())
		.filter(Boolean);
	if (!clauses.length) throw new Error(`set of ${domain}: declaration needs an id field (e.g. "by id, with name")`);
	const context: Record<string, unknown> = { [clauses[0]]: "@id" };
	const queryable: string[] = [];
	for (const clause of clauses.slice(1)) {
		const withM = clause.match(/^with\s+(\S+)(?:\s+as\s+(\S+))?$/);
		if (withM) {
			const [, field, type] = withM;
			const iri = REL_CONTEXT[field as TRel];
			if (!iri) throw new Error(`set of ${domain}: field "${field}" is not a known relation, use the JSON-LD form with an explicit @id`);
			const xsd = type ? XSD_FOR[type.toLowerCase()] : "";
			if (type && xsd === undefined) throw new Error(`set of ${domain}: unknown field type "${type}"`);
			context[field] = xsd ? { "@id": iri, "@type": xsd } : iri;
			queryable.push(field);
			continue;
		}
		const usedM = clause.match(/^used in\s+(\S+)$/);
		if (usedM) {
			context.usedIn = { "@id": REL_CONTEXT[LinkRelations.PART_OF.rel], range: usedM[1] };
			continue;
		}
		throw new Error(`set of ${domain}: unrecognized clause "${clause}" (expected "with <field> [as <type>]" or "used in <Range>")`);
	}
	return { "@context": context, ...(queryable.length ? { "@queryable": queryable } : {}) } as THypermediaContext;
}

export function provenanceFromFeatureStep(featureStep: TFeatureStep): TProvenanceIdentifier {
	return {
		in: featureStep.in,
		seq: featureStep.seqPath,
		when: `${featureStep.action.stepperName}.steps.${featureStep.action.actionName}`,
	};
}

const extractValuesFromFragments = (valueFragments?: TFeatureStep[], fallback?: string) => {
	if (valueFragments?.length) {
		const innerChunks = valueFragments
			.map((fragment) => {
				const raw = fragment.in ?? fragment.action?.stepValuesMap?.items?.term ?? "";
				const trimmed = raw.trim();
				if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
					return trimmed.slice(1, -1).trim();
				}
				return trimmed;
			})
			.filter(Boolean);
		const inner = innerChunks.join(" ").trim();
		if (!inner) {
			throw new Error("Set values cannot be empty");
		}
		return parseQuotedOrWordList(inner);
	}
	if (fallback) {
		return parseBracketedValues(fallback);
	}
	throw new Error("Set statement missing values");
};

const parseBracketedValues = (raw: string) => {
	const trimmed = raw.trim();
	const start = trimmed.indexOf("[");
	const end = trimmed.lastIndexOf("]");
	if (start === -1 || end === -1 || end <= start) {
		throw new Error("Set values must include [ ]");
	}
	const inner = trimmed.substring(start + 1, end).trim();
	return parseQuotedOrWordList(inner);
};

const compareDomainValues = (domain: { comparator?: (a: unknown, b: unknown) => number }, left: unknown, right: unknown, domainName: string): number => {
	if (domain.comparator) {
		return domain.comparator(left, right);
	}
	if (typeof left === "number" && typeof right === "number") {
		return left - right;
	}
	if (left instanceof Date && right instanceof Date) {
		return left.getTime() - right.getTime();
	}
	throw new Error(`Domain ${domainName} does not support magnitude comparison`);
};

// ======== Helpers ========

// Returns OK if "set empty" and variable exists
async function shouldSkipEmpty(featureStep: TFeatureStep, term: string, shared: FeatureVariables): Promise<typeof OK | undefined> {
	if (!featureStep.in.includes("set empty ")) return undefined;
	const resolved = await shared.resolveVariable({ term, origin: Origin.var }, featureStep, undefined, { secure: true });
	return resolved.value !== undefined ? OK : undefined;
}

// Wraps shared.set in try/catch
async function trySetVariable(
	shared: FeatureVariables,
	opts: { term: string; value: TAnyFixme; domain: string; origin: TOrigin; readonly?: boolean; secret?: boolean },
	provenance: TProvenanceIdentifier,
): Promise<TActionResult> {
	try {
		await shared.set(
			{
				term: opts.term,
				value: opts.value,
				domain: opts.domain,
				origin: opts.origin,
				readonly: opts.readonly,
				secret: opts.secret,
			},
			provenance,
		);
		return OK;
	} catch (e: unknown) {
		return actionNotOK((e as Error).message);
	}
}

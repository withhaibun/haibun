import { listOf } from "../lib/domains/lists.js";
import { z } from "zod";

import { runEnvVariable, type TWorld } from "../lib/actuality/domains/world.js";
import { OK, Origin, TProvenanceIdentifier, TOrigin, TActionResult, TStepValue, type TStepValueValue } from "../lib/domains/protocol.js";
import {
	AStepper,
	IHasCycles,
	TStepperSteps,
	TFeatureStep,
	IStepperCycles,
	TStartScenario,
	provenanceFromFeatureStep,
	PREDICATE,
	coercionSite,
} from "../lib/steps/domains/stepper.js";
import { actionOK, actionNotOK, actionOKWithProducts, getStepTerm, errorDetail } from "../lib/domains/util.js";
import { itemAt } from "../lib/domains/item-at.js";
import { proveStatements, stepperContext } from "../lib/actuality/pipelines/step-dispatch.js";
import { FeatureVariables, statedValue } from "../lib/actuality/pipelines/feature-variables.js";
import { OBSCURED_VALUE } from "../lib/steps/domains/secrets.js";
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
	registeredDomain,
} from "../lib/domains/domains.js";
import { fromJsonText } from "../lib/domains/json-text.js";
import { typeCollectionRemedy } from "../lib/domains/typed-links.js";
import { counted, CountedFields, HypermediaContextSchema, hypermediaDomainFromContext, type THypermediaContext } from "../lib/domains/hypermedia.js";
import { AccessLevelSchema, edgeRanges, isPersisted, REL_CONTEXT, LinkRelations, type TRel, type TRegisteredDomain, type TDomainDefinition } from "../lib/domains/resources.js";

const clearVars = (vars: VariablesStepper) => async () => {
	await vars.getWorld().shared.clear();
};

const DOMAIN_VARS_SNAPSHOT = "vars-snapshot";
const DOMAIN_VAR_SNAPSHOT = "var-snapshot";
const DOMAIN_DOMAINS_SNAPSHOT = "domains-snapshot";
const DOMAIN_DOMAIN_SNAPSHOT = "domain-snapshot";

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
	...CountedFields,
});
const DomainSnapshotSchema = z.object({
	domain: z.string(),
	description: z.string(),
	values: z.array(z.string()).optional(),
	stepperName: z.string().optional(),
	topology: z.record(z.string(), z.unknown()).optional(),
	members: z.record(z.string(), z.unknown()),
});

const varsSummary = (p: Record<string, unknown>) => {
	const count = Object.keys(VarsSnapshotSchema.parse(p).vars).length;
	return `${count} variable${count === 1 ? "" : "s"}`;
};

const varSummary = (p: Record<string, unknown>) => {
	const term = String(p.term ?? "");
	const display = p.secret ? OBSCURED_VALUE : typeof p.value === "object" ? JSON.stringify(p.value) : String(p.value);
	return `${term} = ${display}`;
};

/** A failed comparison's message. The message states a secret's value obscured, on either side. */
const mismatch = (term: string, held: TStepValue, compared: unknown, comparedWith: TStepValue) =>
	`${term} is ${JSON.stringify(statedValue(held.value, held.secret))}, not ${JSON.stringify(statedValue(compared, comparedWith.secret))}`;

const domainsSummary = (p: Record<string, unknown>) => `${DomainsSnapshotSchema.parse(p).items.length} domains`;
const domainSummary = (p: Record<string, unknown>) => {
	const { domain, members } = DomainSnapshotSchema.parse(p);
	return `${domain}: ${Object.keys(members).length} members`;
};

const cycles = (variablesStepper: VariablesStepper): IStepperCycles => ({
	startFeature: clearVars(variablesStepper),
	startScenario: async ({ scopedVars }: TStartScenario) => {
		variablesStepper.getWorld().shared = new FeatureVariables(variablesStepper.getWorld(), await scopedVars.carried());
	},
	getConcerns: () => ({
		domains: [
			{ selectors: [DOMAIN_VARS_SNAPSHOT], schema: VarsSnapshotSchema, description: "Snapshot of feature variables", ui: { summary: varsSummary } },
			{ selectors: [DOMAIN_VAR_SNAPSHOT], schema: VarSnapshotSchema, description: "Snapshot of a single variable", ui: { summary: varSummary } },
			{
				selectors: [DOMAIN_DOMAINS_SNAPSHOT],
				schema: DomainsSnapshotSchema,
				list: listOf(DomainsSnapshotSchema, "items"),
				description: "Snapshot of every registered domain",
				ui: { summary: domainsSummary },
			},
			{ selectors: [DOMAIN_DOMAIN_SNAPSHOT], schema: DomainSnapshotSchema, description: "Snapshot of a registered domain and its members", ui: { summary: domainSummary } },
		],
	}),
});

class VariablesStepper extends AStepper implements IHasCycles {
	description = "Set, get, and compare variables; define domains and check membership";

	cycles = cycles(this);
	steppers: AStepper[] = [];
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.world = world;
		this.steppers = steppers;
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
		statementSetValues: { gwta: `\\[{items: ${DOMAIN_SET_VALUES}}\\]`, action: () => OK },
		composeAs: {
			gwta: `compose {what: ${DOMAIN_VARIABLE_NAME}} as {domain: ${DOMAIN_DOMAIN_KEY}} with {template: ${DOMAIN_TEMPLATE}}`,
			precludes: [`${VariablesStepper.name}.compose`],
			action: async ({ what, domain, template }: { what: string; domain: string; template: string }, featureStep: TFeatureStep) => {
				const result = await this.getWorld().shared.interpolate(template, featureStep);
				if ("error" in result) return actionNotOK(result.error);

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
				const result = await this.getWorld().shared.interpolate(template, featureStep);
				if ("error" in result) return actionNotOK(result.error);

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
				const result = await proveStatements(stepperContext(this.getWorld(), this.steppers), featureStep, statement);
				if (!result.ok) return actionNotOK(`set from statement failed: ${result.errorMessage}`);
				if (result.products === undefined)
					return actionNotOK(`set ${what} from a statement: the statement returned without products to set. Use a statement that produces products`);
				await this.getWorld().shared.setJSON(what, result.products, Origin.var, featureStep);
				return actionOK();
			},
		},
		increment: {
			gwta: `increment {what: ${DOMAIN_VARIABLE_NAME}}`,
			action: async ({ what: term }: { what: string }, featureStep: TFeatureStep) => {
				const resolved = await this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep);
				const presentVal = resolved.value;
				const effectiveDomain = resolved.domain;

				if (presentVal === undefined) {
					return actionNotOK(`the variable ${term} isn't set; set it before this step reads it`);
				}

				// A variable of an ordered set advances to the value its order puts next, and stays at the last.
				const registered = this.getWorld().domains[normalizeDomainKey(effectiveDomain)];
				if (registered?.comparator !== undefined && registered.values !== undefined) {
					const at = registered.values.indexOf(String(presentVal));
					if (at === -1) return actionNotOK(`${term} has value "${presentVal}" which is not in domain values`);
					const next = registered.values[at + 1];
					if (next !== undefined) await this.getWorld().shared.set({ term, value: next, domain: effectiveDomain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
					return OK;
				}

				// Fallback: numeric increment
				const numVal = Number(presentVal);
				if (isNaN(numVal)) {
					return actionNotOK(`cannot increment non-numeric variable ${term} with value "${presentVal}"`);
				}
				const newNum = numVal + 1;
				await this.getWorld().shared.set({ term, value: String(newNum), domain: effectiveDomain, origin: Origin.var }, provenanceFromFeatureStep(featureStep));
				this.getWorld().eventLogger.log(featureStep, "info", `incremented ${term} to ${newNum}`, {
					variable: term,
					oldValue: presentVal,
					newValue: newNum,
					operation: "increment",
				});
				return OK;
			},
		},
		showVars: {
			gwta: "show vars",
			productsDomain: DOMAIN_VARS_SNAPSHOT,
			action: async () => {
				const vars = Object.fromEntries(Object.entries(await this.getWorld().shared.all()).map(([key, variable]) => [key, variable.value]));
				return actionOKWithProducts({ vars });
			},
		},
		set: {
			gwta: `set( empty)? {what: ${DOMAIN_VARIABLE_NAME}} to {value: ${DOMAIN_VARIABLE_VALUE}}`,
			action: async ({ what: term, value }: { what: string; value: TStepValue }, featureStep: TFeatureStep) => {
				const skip = await shouldSkipEmpty(featureStep, term, this.getWorld().shared);
				if (skip) return skip;

				// A variable set again keeps its domain.
				const existing = await this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep);
				const result = trySetVariable(
					this.getWorld().shared,
					{ term, value: String(value.value), domain: existing?.domain ?? DOMAIN_STRING, origin: Origin.var, secret: value.secret },
					provenanceFromFeatureStep(featureStep),
				);
				return result;
			},
		},
		setAs: {
			gwta: `set( empty)? {what: ${DOMAIN_VARIABLE_NAME}} as( read-only)? {domain: ${DOMAIN_DOMAIN_KEY}} to {value: ${DOMAIN_VARIABLE_VALUE}}`,
			precludes: [`${VariablesStepper.name}.set`],
			action: async ({ what: term, domain, value }: { what: string; domain: string; value: TStepValue }, featureStep: TFeatureStep) => {
				const readonly = !!featureStep.in.match(/ as read-only /);

				const skip = await shouldSkipEmpty(featureStep, term, this.getWorld().shared);
				if (skip) return skip;

				return trySetVariable(
					this.getWorld().shared,
					{ term, value: String(value.value), domain, origin: Origin.var, readonly, secret: value.secret },
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
			action: async ({ what: term, value }: { what: string; value: TStepValue }, featureStep: TFeatureStep) => {
				const resolved = await this.getWorld().shared.resolveVariable({ term, origin: Origin.defined }, featureStep, undefined, { secure: true });
				if (resolved.value === undefined || (resolved.origin !== Origin.var && resolved.origin !== Origin.env)) {
					return actionNotOK(await this.getWorld().shared.unsetReason(term));
				}

				const domainKey = normalizeDomainKey(resolved.domain);
				const compared = registeredDomain(this.getWorld().domains, domainKey, `the value of ${term}`);
				const compareVal = compared.coerce({ term: "_cmp", value: String(value.value), domain: domainKey, origin: Origin.quoted }, coercionSite(featureStep, this.steppers));

				return JSON.stringify(resolved.value) === JSON.stringify(compareVal) ? OK : actionNotOK(mismatch(term, resolved, compareVal, value));
			},
		},
		isLessThan: {
			gwta: `variable {what: ${DOMAIN_VARIABLE_NAME}} is less than {value: ${DOMAIN_VARIABLE_VALUE}}`,
			precludes: ["VariablesStepper.is"],
			description: "Holds where the order of the variable's domain puts its value before the value, precedes(D, x, v): an ordered set's order, a number's or a date's.",
			action: ({ what, value }: { what: string; value: TStepValue }, featureStep: TFeatureStep) => this.ordered(featureStep, what, value, (order) => order < 0),
		},
		isMoreThan: {
			gwta: `variable {what: ${DOMAIN_VARIABLE_NAME}} is more than {value: ${DOMAIN_VARIABLE_VALUE}}`,
			precludes: ["VariablesStepper.is"],
			description: "Holds where the order of the variable's domain puts the value before its value, precedes(D, v, x): an ordered set's order, a number's or a date's.",
			action: ({ what, value }: { what: string; value: TStepValue }, featureStep: TFeatureStep) => this.ordered(featureStep, what, value, (order) => order > 0),
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
				return runEnvVariable(this.getWorld(), term) !== undefined ? OK : actionNotOK(`the variable ${term} isn't set, and the environment doesn't hold it`);
			},
		},
		showVar: {
			gwta: `show var {what: ${DOMAIN_VARIABLE_NAME}}`,
			productsDomain: DOMAIN_VAR_SNAPSHOT,
			action: async ({ what: term }: { what: string }, featureStep: TFeatureStep) => {
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
				const keys = Object.values(await this.getWorld().shared.all()).flatMap(({ domain }) => (domain && normalizeDomainKey(domain) ? [normalizeDomainKey(domain)] : []));
				const members = new Map([...Map.groupBy(keys, (key) => key)].map(([key, held]) => [key, held.length]));
				const items = Object.entries(this.getWorld().domains).map(([name, { description, values, topology }]) => {
					const persistedAs = isPersisted(topology) ? topology.persistedAs : undefined;
					// The edges a persisted type's topology declares to another persisted type.
					const _edges = (isPersisted(topology) && topology.edges ? Object.entries(topology.edges) : []).flatMap(([type, edge]) =>
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
				return actionOKWithProducts({ items, ...counted(items.length) });
			},
		},
		showDomain: {
			gwta: `show domain {name: ${DOMAIN_DOMAIN_KEY}}`,
			productsDomain: DOMAIN_DOMAIN_SNAPSHOT,
			action: async ({ name }: { name: string }) => {
				const domain = registeredDomain(this.getWorld().domains, name, "show domain");
				const members: Record<string, TStepValueValue> = {};
				for (const [key, variable] of Object.entries(await this.getWorld().shared.all())) {
					if (variable.domain && normalizeDomainKey(variable.domain) === name) members[key] = variable.value;
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
		isIn: {
			gwta: `{value: ${DOMAIN_VARIABLE_VALUE}} is in {domain: ${DOMAIN_DOMAIN_KEY}}`,
			predicate: PREDICATE.memberOf,
			// A quantifier's line, such as every x in D is S, matches this pattern too, and a quantifier takes the line.
			fallback: true,
			description: "Holds where the value is one of the values the domain's set of declaration lists, or a variable set in it holds: member_of(V, D).",
			action: async ({ value, domain }: { value: TStepValue; domain: string }) => {
				const members = await this.getWorld().shared.getDomainValues(domain);
				if (members.error !== undefined) return actionNotOK(members.error);
				return members.values.map(String).includes(String(value.value)) ? OK : actionNotOK(`"${statedValue(String(value.value), value.secret)}" is not in ${domain}`);
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
				// Interpolate variables in pattern (e.g., "{counter URI}*" -> "http://localhost:8123/*")
				const interpolated = await this.getWorld().shared.interpolate(pattern, featureStep, { lenient: true });
				if ("error" in interpolated) return actionNotOK(interpolated.error);
				const actualPattern = interpolated.value;
				const glob = new RegExp(globSource(actualPattern), "s");
				// value/pattern are text being compared: an unresolved {X} is literal data (e.g. a captured reply echoing
				// "{StepperName}"), not a variable reference, so interpolate leniently and leave unknown braces in place.
				const textOf = (item: unknown) => this.getWorld().shared.interpolate(typeof item === "string" ? item : JSON.stringify(item), featureStep, { lenient: true });
				const statedPattern = statedValue(actualPattern, interpolated.secret);
				// A list matches where one of its items does, each read as its own text.
				if (Array.isArray(value.value)) {
					for (const item of value.value) {
						const text = await textOf(item);
						if ("error" in text) return actionNotOK(text.error);
						if (glob.test(text.value)) return OK;
					}
					return actionNotOK(`the ${value.value.length} items of the list don't match pattern "${statedPattern}"`);
				}
				const actual = await textOf(value.value);
				if ("error" in actual) return actionNotOK(actual.error);
				return glob.test(actual.value) ? OK : actionNotOK(`"${statedValue(actual.value, value.secret || actual.secret)}" does not match pattern "${statedPattern}"`);
			},
		},
	} as const satisfies TStepperSteps;

	readonly typedSteps = this.steps;

	/** Holds where `holds` reads the order of the variable's domain between its value and the value: below zero where the order
	 *  puts the variable's value first. Refuses a variable whose domain doesn't order its values. */
	private async ordered(featureStep: TFeatureStep, term: string, value: TStepValue, holds: (order: number) => boolean): Promise<TActionResult> {
		const stored = await this.getWorld().shared.resolveVariable({ term, origin: Origin.var }, featureStep, this.steppers, { secure: true });
		if (stored.value === undefined) return actionNotOK(await this.getWorld().shared.unsetReason(term));
		const domainKey = normalizeDomainKey(stored.domain);
		const domain = registeredDomain(this.getWorld().domains, domainKey, `the value of ${term}`);
		if (domain.comparator === undefined)
			return actionNotOK(`the domain ${domainKey} of ${term} doesn't order its values; compare a variable of an ordered set, a number or a date`);
		const left = domain.coerce({ ...stored, domain: domainKey }, coercionSite(featureStep, this.steppers));
		const right = domain.coerce({ term: `${term}__comparison`, value: String(value.value), domain: domainKey, origin: Origin.quoted }, coercionSite(featureStep, this.steppers));
		return holds(domain.comparator(left, right)) ? OK : actionNotOK(mismatch(term, { ...stored, value: left }, right, value));
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
				return actionNotOK(`the domain "${domainKey}" is already registered; declare a domain of another name`);
			}
			const superdomainDefs: TRegisteredDomain[] = uniqueNames.map((name) => {
				const normalized = normalizeDomainKey(name);
				return registeredDomain(this.getWorld().domains, normalized, `the set of ${domainKey}`);
			});
			const enumSources = superdomainDefs.filter((entry) => Array.isArray(entry.values) && entry.values.length);
			const uniqueValues = Array.from(new Set(enumSources.flatMap((entry) => entry.values ?? [])));
			const description = `Values inherited from ${uniqueNames.join(", ")}`;
			if (enumSources.length === superdomainDefs.length && uniqueValues.length) {
				const definition = createEnumDomainDefinition({ name: domainKey, values: uniqueValues, description });
				registerDomains(this.getWorld(), [[definition]]);
				return OK;
			}
			const [firstSchema, ...moreSchemas] = superdomainDefs.map((entry) => entry.schema);
			if (!firstSchema) {
				throw new Error("Superdomains did not expose any schema to derive from");
			}
			const mergedSchema = moreSchemas.reduce<z.ZodType>((merged, schema) => z.union([merged, schema]), firstSchema);
			const definition: TDomainDefinition = { selectors: [domainKey], schema: mergedSchema, description };
			registerDomains(this.getWorld(), [[definition]]);
			return OK;
		} catch (error) {
			return actionNotOK(`the set of "${domain}" isn't registered from its superdomains: ${errorDetail(error)}`);
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
				return actionNotOK(`the domain "${domainKey}" is already registered; declare a domain of another name`);
			}
			const definition = createEnumDomainDefinition({ name: domainKey, values, description: options?.description, ordered: options?.ordered });
			registerDomains(this.getWorld(), [[definition]]);
			return OK;
		} catch (error) {
			return actionNotOK(`the set of "${domain}" isn't registered from its values: ${errorDetail(error)}`);
		}
	}

	private registerHypermediaDomain(domain: string, spec: string) {
		try {
			const doc: THypermediaContext = spec.startsWith("{") ? fromJsonText(HypermediaContextSchema).parse(spec) : parseHypermediaDeclProse(domain, spec);
			const { topology, schema } = hypermediaDomainFromContext(domain, doc);
			const selector = domain.toLowerCase();
			const domainKey = normalizeDomainKey(selector);
			if (this.getWorld().domains[domainKey]) return actionNotOK(`the domain "${domainKey}" is already registered; declare a domain of another name`);
			registerDomains(this.getWorld(), [[{ selectors: [selector], schema: fromJsonText(schema), description: domain, topology, ui: { declared: true } }]]);
			return OK;
		} catch (error) {
			return actionNotOK(`the set of "${domain}" isn't registered from its declaration: ${errorDetail(error)}`);
		}
	}
}

export default VariablesStepper;

/** The clause of a declaration that states the storage level of its records. */
const STORED_AT = /^stored at\s+(\S+)$/;

const XSD_FOR: Record<string, string> = {
	number: "xsd:integer",
	integer: "xsd:integer",
	decimal: "xsd:decimal",
	boolean: "xsd:boolean",
	date: "xsd:date",
	datetime: "xsd:dateTime",
	string: "",
};

/** Prose shorthand → JSON-LD @context: `id, with name [as number], used in Recipe, stored at private`. The first clause is
 * the id field; `with {field}` maps the field to its same-named relation (queryable); `used in {Range}`
 * is the usedIn (isPartOf) edge; `stored at {level}` states the level the type's records are stored at, and a declaration
 * without it is refused. Non-relation field names need the JSON-LD form with an explicit @id. */
function parseHypermediaDeclProse(domain: string, spec: string): THypermediaContext {
	const clauses = spec
		.split(",")
		.map((c) => c.trim())
		.filter(Boolean);
	const [idField, ...fields] = clauses;
	if (!idField) throw new Error(`set of ${domain}: declaration needs an id field (e.g. "by id, with name")`);
	const context: THypermediaContext["@context"] = { [idField]: "@id" };
	const queryable: string[] = [];
	let accessLevel: string | undefined;
	for (const clause of fields) {
		const storedM = clause.match(STORED_AT);
		if (storedM) {
			accessLevel = storedM[1];
			continue;
		}
		const withM = clause.match(/^with\s+(\S+)(?:\s+as\s+(\S+))?$/);
		if (withM) {
			const field = itemAt(withM, 1);
			const type = withM[2];
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
		throw new Error(`set of ${domain}: unrecognized clause "${clause}" (expected "with <field> [as <type>]", "used in <Range>" or "stored at <level>")`);
	}
	if (accessLevel === undefined)
		throw new Error(
			`set of ${domain}: the declaration doesn't state the storage level of its records. Add the clause "stored at <level>", where the level is one of ${AccessLevelSchema.options.join(", ")}.`,
		);
	return HypermediaContextSchema.parse({ "@context": context, ...(queryable.length ? { "@queryable": queryable } : {}), "@accessLevel": accessLevel });
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
	throw new Error("the set statement doesn't state its values; state them in brackets, such as [a b]");
};

const parseBracketedValues = (raw: string) => {
	const trimmed = raw.trim();
	const start = trimmed.indexOf("[");
	const end = trimmed.lastIndexOf("]");
	if (start === -1 || end === -1 || end <= start) {
		throw new Error("the set's values aren't in brackets; state them in brackets, such as [a b]");
	}
	const inner = trimmed.substring(start + 1, end).trim();
	return parseQuotedOrWordList(inner);
};

// ======== Helpers ========

// Returns OK if "set empty" and variable exists
async function shouldSkipEmpty(featureStep: TFeatureStep, term: string, shared: FeatureVariables): Promise<typeof OK | undefined> {
	if (!featureStep.in.includes("set empty ")) return undefined;
	const resolved = await shared.resolveVariable({ term, origin: Origin.var }, featureStep, undefined, { secure: true });
	return resolved.value !== undefined ? OK : undefined;
}

/** Sets a variable. Refuses a value its domain's schema rejects with the domain to open, which states the values the domain
 *  takes, and refuses any other failure with what failed and why. */
async function trySetVariable(
	shared: FeatureVariables,
	opts: { term: string; value: TStepValueValue; domain: string; origin: TOrigin; readonly?: boolean; secret?: boolean },
	provenance: TProvenanceIdentifier,
): Promise<TActionResult> {
	try {
		await shared.set({ term: opts.term, value: opts.value, domain: opts.domain, origin: opts.origin, readonly: opts.readonly, secret: opts.secret }, provenance);
		return OK;
	} catch (error) {
		if (error instanceof z.ZodError) {
			const domainKey = normalizeDomainKey(opts.domain);
			return actionNotOK(`the domain ${domainKey} rejects the value of ${opts.term}: ${errorDetail(error)}. Set a value the domain takes`, {
				remedy: typeCollectionRemedy(domainKey),
			});
		}
		return actionNotOK(`the variable ${opts.term} isn't set: ${errorDetail(error)}`);
	}
}

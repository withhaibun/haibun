/**
 * The rules of a repository's steps, read from its steppers and from the features, the tests and the code that call them. A step that
 * starts or keeps something and doesn't return a product takes a parameter, since a stepper starts what each feature needs as
 * the feature starts, where an option states it (lifecycle). A step has more than one call site, since what one feature alone states is a waypoint of that
 * feature or of a module's library (one call site). A step's pattern isn't another step's with a word more or less, since one
 * primitive takes the difference as a parameter (near-duplicate). A feature line, a kireji call, a waypoint or a unit test
 * exercises every step, since a step that doesn't run isn't shown to work (unexercised). The count of declared steps only falls,
 * so a change that adds a step removes one that it replaces (step count). A step's pattern doesn't filter, bound, page, order or count
 * its own list, since a combinator applies each of those to a plain read (list operation). A domain whose products hold a list
 * of records or a count declares its list, so a combinator reads it (undeclared list). A step whose action only states other
 * steps with fixed arguments is a waypoint of a module's library (fixed statement).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { AStepper, hasCycles } from "../steps/domains/stepper.js";
import type { TDomainDefinition } from "../domains/resources.js";
import { namedInterpolation } from "../steps/derivations/named-vars.js";
import { constructorName, dePolite } from "../domains/util.js";
import type { TFound } from "./baseline.js";
import { sourceFiles, TEST_MODULE, unwrapped } from "./repository-files.js";

export const STARTS_WITHOUT_PARAMETERS = "starts or keeps something without a parameter";
export const ONE_CALL_SITE = "has at most one call site";
export const NEAR_DUPLICATE = "states another step's pattern with a word more or less";
export const UNEXERCISED = "isn't exercised by a feature line, a kireji call, a waypoint or a unit test";
export const DECLARED_STEPS = "declares steps";
export const LIST_OPERATION = "filters, bounds, pages, orders or counts its own list";
export const UNDECLARED_LIST = "returns a list of records or a count its domain doesn't declare as a list";
export const FIXED_STATEMENT = "only states other steps with fixed arguments";
export const UNUSED_SELECTION = "names as a selection a step whose pattern doesn't operate on a list";
/** The file a repository's count of declared steps is recorded under: the repository itself. */
export const REPOSITORY_FILE = ".";

/** How a step's pattern reads a line: as a phrase with placeholders, or as the exact line. */
type TPatternKind = "gwta" | "exact";
/** A step a stepper declares: the stepper's source file and name, its key and pattern, and what the rules read of it. */
export type TDeclaredStep = {
	file: string;
	stepper: string;
	key: string;
	kind: TPatternKind;
	pattern: string;
	parameters: boolean;
	read: boolean;
	products: boolean;
	precludes: readonly string[];
	/** Whether the step applies a listing to its statement's list: a list combinator. */
	combinator: boolean;
	/** The domains its products are, by name. */
	productsDomains: readonly string[];
};

/** A line that starts or keeps something, which a stepper's start cycle does where an option states it. */
const STARTS = /^(create|discover|enable|keep|mount|open|register|serve|start|subscribe|watch|this feature runs)\b/i;
/** A feature source: a feature file, a kireji feature or background, a waypoint library's background, or a guide run as a feature. */
const FEATURE_SOURCE = /\.feature(\.ts)?$|\/(features|backgrounds)\/[^/]+\.ts$|^AGENTS\.md$/;
const SOURCE = /\.tsx?$/;
/** The word a template's substitution stands for in a line, which a placeholder matches. */
const SUBSTITUTED = "X";
/** The kireji function that returns a stepper's steps as functions of their inputs. */
const WITH_ACTION = "withAction";
const STEPPER_FILE = /-stepper\.ts$/;

/** Each stepper class that a stepper file under `roots` exports and a config loads, constructed without an argument as a config
 *  constructs it, with the file by its path from the repository root. */
export async function steppersUnder(repository: string, roots: readonly string[]): Promise<{ file: string; stepper: AStepper }[]> {
	const files = sourceFiles(repository, roots).filter((file) => STEPPER_FILE.test(file));
	const loaded = await Promise.all(files.map(async (file) => ({ file, exported: Object.values((await import(join(repository, file))) as Record<string, unknown>) })));
	return loaded.flatMap(({ file, exported }) =>
		[...new Set(exported)]
			.filter((C): C is new () => AStepper => typeof C === "function" && C.prototype instanceof AStepper && C.length === 0)
			.map((C) => ({ file, stepper: new C() })),
	);
}

/** Each step `steppers` declare, with its stepper's source file. A step a stepper inherits from another stepper in `steppers`
 *  is that stepper's, so it is listed once. */
export function declaredSteps(steppers: readonly { file: string; stepper: AStepper }[]): TDeclaredStep[] {
	const seen = new Set<string>();
	return steppers.flatMap(({ file, stepper }) =>
		Object.entries(stepper.steps).flatMap(([key, step]) => {
			const pattern = step.gwta ?? step.exact;
			const declaredBy = declaringStepper(stepper, key, pattern);
			if (pattern === undefined || seen.has(`${declaredBy}.${key}`)) return [];
			seen.add(`${declaredBy}.${key}`);
			const kind: TPatternKind = step.gwta === undefined ? "exact" : "gwta";
			const productsDomains = [
				...(step.productsDomain === undefined ? [] : [step.productsDomain]),
				...(step.productsDomains === undefined ? [] : Object.values(step.productsDomains)),
			];
			const combinator = step.transformsList !== undefined;
			const declared = { file, stepper: declaredBy, key, kind, pattern, parameters: pattern.includes("{"), read: step.read === true, products: productsDomains.length > 0 };
			return [{ ...declared, precludes: step.precludes ?? [], combinator, productsDomains }];
		}),
	);
}

/** The name of the topmost class in a stepper's chain whose instance declares `key` with `pattern`. */
function declaringStepper(stepper: AStepper, key: string, pattern: string | undefined): string {
	let declaredBy = constructorName(stepper);
	for (let parent = Object.getPrototypeOf(stepper.constructor); parent?.prototype instanceof Object && parent.name !== "AStepper"; parent = Object.getPrototypeOf(parent)) {
		const step = (new parent() as AStepper).steps?.[key];
		if (step === undefined || (step.gwta ?? step.exact) !== pattern) break;
		declaredBy = parent.name;
	}
	return declaredBy;
}

/** Each step without a parameter, not a read and without a product, whose line starts or keeps something. A step that returns
 *  what it opened, such as a key, returns it to its caller, which an option doesn't do. */
export function startsWithoutParameters(steps: readonly TDeclaredStep[]): TFound[] {
	return steps
		.filter((s) => !s.parameters && !s.read && !s.products && STARTS.test(s.pattern))
		.map((s) => ({ file: s.file, finding: `${STARTS_WITHOUT_PARAMETERS}: ${s.stepper}.${s.key}` }));
}

/** A pattern's words: a placeholder is `{}`, and an optional group isn't a word. */
const wordsOf = (pattern: string): string[] =>
	pattern
		.replace(/\([^()]*\)\?/g, "")
		.replace(/\{[^}]*\}/g, " {} ")
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);

/** Whether `longer` is `shorter` with one word more that isn't a placeholder. */
function oneWordMore(longer: readonly string[], shorter: readonly string[]): boolean {
	if (longer.length !== shorter.length + 1) return false;
	const at = longer.findIndex((word, i) => word !== shorter[i]);
	const extra = at === -1 ? longer.length - 1 : at;
	return longer[extra] !== "{}" && longer.every((word, i) => i === extra || word === shorter[i < extra ? i : i - 1]);
}

/** Each pair of steps whose patterns are the same words, or one's words with one word more, where one doesn't preclude the other.
 *  A pattern without a word, such as the empty line's, isn't a phrase another repeats. */
export function nearDuplicates(steps: readonly TDeclaredStep[]): TFound[] {
	const worded = steps.map((step) => ({ step, words: wordsOf(step.pattern) })).filter(({ words }) => words.length > 0);
	const precluded = (a: TDeclaredStep, b: TDeclaredStep) => a.precludes.some((p) => p === `${b.stepper}.${b.key}`) || b.precludes.some((p) => p === `${a.stepper}.${a.key}`);
	return worded.flatMap(({ step: a, words: aw }, i) =>
		worded
			.slice(i + 1)
			.filter(({ step: b, words: bw }) => !precluded(a, b) && (aw.join(" ") === bw.join(" ") || oneWordMore(aw, bw) || oneWordMore(bw, aw)))
			.map(({ step: b, words: bw }) => {
				const [longer, shorter] = bw.length > aw.length ? [b, a] : [a, b];
				return { file: longer.file, finding: `${NEAR_DUPLICATE}: ${longer.stepper}.${longer.key} ~ ${shorter.stepper}.${shorter.key}` };
			}),
	);
}

/** The files of a repository that git tracks or would track, by their paths from the repository root. */
const repositoryFiles = (repository: string): string[] =>
	execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: repository, encoding: "utf-8" }).split("\n").filter(Boolean);

/** What a feature source states: its lines, and each kireji call by the key of the step it calls. */
type TStated = { lines: string[]; calls: string[] };

/** The lines and the kireji calls a kireji source states: each line of its strings, a template's substitution as a word, and
 *  each call of a function that `withAction` returned. */
function statedInKireji(source: ts.SourceFile): TStated {
	const lines: string[] = [];
	const calls: string[] = [];
	const keys = new Map<string, string>();
	const visit = (node: ts.Node): void => {
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) lines.push(...node.text.split("\n"));
		else if (ts.isTemplateExpression(node)) lines.push(...[node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(SUBSTITUTED).split("\n"));
		else if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
			if (node.initializer.expression.getText(source) === WITH_ACTION)
				for (const element of node.name.elements) keys.set(element.name.getText(source), (element.propertyName ?? element.name).getText(source));
		} else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
			const key = keys.get(node.expression.text);
			if (key !== undefined) calls.push(key);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return { lines: lines.map((line) => line.trim()).filter(Boolean), calls };
}

/** A file of a repository, by its path from the repository root, with its text. */
type TFileText = { file: string; text: string };

/** Each of `files` with its text, read once. */
const textsOf = (repository: string, files: readonly string[]): TFileText[] => files.map((file) => ({ file, text: readFileSync(join(repository, file), "utf-8") }));

/** What `files` state: each line of a feature file, and the lines and kireji calls of a TypeScript source's strings. */
function statedIn(files: readonly TFileText[]): TStated {
	const stated = files.map(({ file, text }): TStated => {
		if (!SOURCE.test(file))
			return {
				lines: text
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean),
				calls: [],
			};
		return statedInKireji(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
	});
	return { lines: stated.flatMap((s) => s.lines), calls: stated.flatMap((s) => s.calls) };
}

/** The first word of a pattern or a line, read the same way for both, so a word a colon follows, as in `Backgrounds:`, groups its
 *  lines with its step. */
const FIRST_WORD = /^[a-z][\w'-]*/i;

/** The ends of a line that a statement nested in it can state: the line, and its text after each space. */
const endsOf = (line: string): string[] => [line, ...[...line.matchAll(/ /g)].map((space) => line.slice((space.index ?? 0) + 1))];

/** How many lines state each step, by its stepper and key: a line states a step where the step's pattern matches the line or
 *  the end of it that follows a space, which is where a statement nested in the line is stated. */
function linesStating(steps: readonly TDeclaredStep[], lines: readonly string[]): Map<TDeclaredStep, number> {
	const compiled = steps.map((step) => ({ step, matches: matcherOf(step) }));
	const byWord = new Map<string, typeof compiled>();
	const unworded: typeof compiled = [];
	for (const c of compiled) {
		const first = FIRST_WORD.exec(c.step.pattern)?.[0]?.toLowerCase();
		if (first === undefined || c.step.pattern.startsWith(`${first}(`)) unworded.push(c);
		else byWord.set(first, [...(byWord.get(first) ?? []), c]);
	}
	const counts = new Map<TDeclaredStep, number>();
	for (const line of lines)
		for (const end of endsOf(line)) {
			const stated = dePolite(end);
			const word = FIRST_WORD.exec(stated)?.[0]?.toLowerCase() ?? "";
			for (const { step, matches } of [...(byWord.get(word) ?? []), ...unworded]) if (matches(stated)) counts.set(step, (counts.get(step) ?? 0) + 1);
		}
	return counts;
}

/** Whether a line states a step, as the resolver reads the step's pattern: the exact line, or its phrase matched over the
 *  whole line regardless of case. */
function matcherOf({ kind, pattern }: TDeclaredStep): (line: string) => boolean {
	if (kind === "exact") return (line) => line === pattern;
	const regex = new RegExp(`^${namedInterpolation(pattern).regexPattern}$`, "i");
	return (line) => regex.test(line);
}

/** A string that names a step: its key, or its key after its stepper's name and a dash, as a call over RPC names it. */
const NAMED_KEY = /^(?:[A-Za-z]\w*-)?([A-Za-z]\w*)$/;

/** Each naming of a step in the initializer of a top-level constant of a source, with the name code reads it through: the
 *  constant, or the constant and the property of its object that holds the naming, and the statement that declares it. */
function constantNamings(file: string, text: string, keys: ReadonlySet<string>): { key: string; read: string; declaration: string }[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	return source.statements.filter(ts.isVariableStatement).flatMap((statement) =>
		statement.declarationList.declarations.flatMap((declaration) => {
			if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return [];
			const constant = declaration.name.text;
			const object = unwrapped(declaration.initializer);
			const found: { key: string; read: string; declaration: string }[] = [];
			const visit = (node: ts.Node, read: string): void => {
				const key = ts.isStringLiteralLike(node) ? NAMED_KEY.exec(node.text)?.[1] : undefined;
				if (key !== undefined && keys.has(key)) found.push({ key, read, declaration: statement.getText(source) });
				ts.forEachChild(node, (child) => visit(child, node === object && ts.isPropertyAssignment(child) ? `${constant}.${child.name.getText(source)}` : read));
			};
			visit(object, constant);
			return found;
		}),
	);
}

/** A whole name in code, and the property of it that code reads. */
const READ_NAME = /(?<![\w$.])([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g;

/** How many times code reads each name, and each name with a property, in `texts`. */
function namesRead(texts: readonly string[]): Map<string, number> {
	const reads = new Map<string, number>();
	for (const text of texts)
		for (const [, name, property] of text.matchAll(READ_NAME))
			for (const read of property === undefined ? [name] : [name, `${name}.${property}`]) if (read !== undefined) reads.set(read, (reads.get(read) ?? 0) + 1);
	return reads;
}

/** A naming of a step's key: after a quote, as a string names it, after a dot, as a property access names it, or after a dash,
 *  after its stepper's name, as a call over RPC names it. */
const KEY_NAMING = /["'`.-]([A-Za-z]\w*)\b/g;

/** The keys of `keys` a text names, each with how many times it names it. */
function keysNamed(text: string, keys: ReadonlySet<string>): Map<string, number> {
	const counts = new Map<string, number>();
	for (const [, key] of text.matchAll(KEY_NAMING)) if (key !== undefined && keys.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
	return counts;
}

/** How many times the code of a repository, apart from each step's own stepper and the tests, calls each step: each naming of
 *  its key. A naming in the initializer of a top-level constant calls the step wherever code reads the constant, or the
 *  property of it that holds the naming, such as each call a page makes through the constant that names a step's method. */
function codeNaming(code: readonly TFileText[], steps: readonly TDeclaredStep[]): Map<TDeclaredStep, number> {
	const keys = new Set(steps.map((s) => s.key));
	const reads = namesRead(code.map(({ text }) => text));
	const named = new Map<string, Map<string, number>>();
	for (const { file, text } of code) {
		const counts = keysNamed(text, keys);
		for (const { key, read, declaration } of constantNamings(file, text, keys)) {
			const elsewhere = (reads.get(read) ?? 0) - (namesRead([declaration]).get(read) ?? 0);
			counts.set(key, (counts.get(key) ?? 0) + Math.max(1, elsewhere) - 1);
		}
		named.set(file, counts);
	}
	return new Map(steps.map((step) => [step, [...named].filter(([file]) => file !== step.file).reduce((sum, [, counts]) => sum + (counts.get(step.key) ?? 0), 0)]));
}

/** A repository's feature sources, its code apart from them and the tests, and its tests, each with its text, read once. */
function sourcesOf(repository: string): { features: TFileText[]; code: TFileText[]; tests: TFileText[] } {
	const files = repositoryFiles(repository);
	const sources = files.filter((file) => SOURCE.test(file) && !FEATURE_SOURCE.test(file));
	return {
		features: textsOf(
			repository,
			files.filter((file) => FEATURE_SOURCE.test(file)),
		),
		code: textsOf(
			repository,
			sources.filter((file) => !TEST_MODULE.test(file)),
		),
		tests: textsOf(
			repository,
			sources.filter((file) => TEST_MODULE.test(file)),
		),
	};
}

/** Each step with at most one call site: lines of features that state it, kireji calls of it, and the code that names it. */
export function oneCallSite(repository: string, steps: readonly TDeclaredStep[]): TFound[] {
	const { features, code } = sourcesOf(repository);
	const { lines, calls } = statedIn(features);
	const stating = linesStating(steps, lines);
	const naming = codeNaming(code, steps);
	return steps
		.filter((step) => (stating.get(step) ?? 0) + calls.filter((key) => key === step.key).length + (naming.get(step) ?? 0) <= 1)
		.map((step) => ({ file: step.file, finding: `${ONE_CALL_SITE}: ${step.stepper}.${step.key}` }));
}

/** Each step that doesn't run: a feature line or a waypoint doesn't state it, a kireji call doesn't call it, and a unit test
 *  doesn't state a line of it, call it through kireji or name it, where the test names the step's stepper. The empty line's
 *  step is every feature's blank line, which a line isn't read as. */
export function unexercised(repository: string, steps: readonly TDeclaredStep[]): TFound[] {
	const { features, tests } = sourcesOf(repository);
	const stated = statedIn([...features, ...tests]);
	const stating = linesStating(steps, stated.lines);
	const calls = new Set(stated.calls);
	const keys = new Set(steps.map((step) => step.key));
	const named = tests.map(({ text }) => ({ text, keys: keysNamed(text, keys) }));
	const tested = (step: TDeclaredStep) => named.some(({ text, keys }) => keys.has(step.key) && text.includes(step.stepper));
	return steps
		.filter((step) => step.pattern !== "" && !stating.has(step) && !calls.has(step.key) && !tested(step))
		.map((step) => ({ file: step.file, finding: `${UNEXERCISED}: ${step.stepper}.${step.key}` }));
}

/** One finding for each declared step, under the repository, so its baseline holds the count of steps, which only falls. */
export const stepCount = (steps: readonly TDeclaredStep[]): TFound[] => steps.map(() => ({ file: REPOSITORY_FILE, finding: DECLARED_STEPS }));

/** A word of a pattern, outside its placeholders, that filters, bounds, pages, orders or counts a list. A web page and an ordered
 *  set aren't a list's page or order, so `page` and `ordered` aren't read. */
const LIST_WORD = /\b(?:limit|limited|offset|matching|whose|count|counting|first|top|sorted|per|number of)\b/i;
/** A bound of a read's list by a number or a time: a time word before such a placeholder, as `since {date}`, or a range of them,
 *  as `from {n} to {m}`. A step that acts, such as one that delegates until a date, doesn't bound a list. */
const BOUNDING_WORD = /\b(?:since|before|after|until)\s+\{[^}:]+:\s*[^}]*(?:number|date|time)[^}]*\}|\bfrom\s+\{[^}:]+:\s*[^}]*number[^}]*\}\s+to\s+\{/i;

/** Each step whose pattern filters, bounds, pages, orders or counts its own list, apart from the combinators, which apply those
 *  to any read, and from `selections`: the steps whose such parameter selects what they act on, each with why. A selection
 *  that names a step the rule doesn't flag is a finding, so the list holds only what it excuses. */
export function listOperations(steps: readonly TDeclaredStep[], selections: Readonly<Record<string, string>>): TFound[] {
	const operating = steps.filter((s) => !s.combinator && (LIST_WORD.test(s.pattern.replace(/\{[^}]*\}/g, " ")) || (s.read && BOUNDING_WORD.test(s.pattern))));
	const named = new Set(operating.map((s) => `${s.stepper}.${s.key}`));
	return [
		...operating.filter((s) => selections[`${s.stepper}.${s.key}`] === undefined).map((s) => ({ file: s.file, finding: `${LIST_OPERATION}: ${s.stepper}.${s.key}` })),
		...Object.keys(selections)
			.filter((step) => !named.has(step))
			.map((step) => ({ file: REPOSITORY_FILE, finding: `${UNUSED_SELECTION}: ${step}` })),
	];
}

/** The schema a field holds, past what makes it optional or nullable. */
function heldSchema(schema: z.ZodType): z.ZodType {
	return schema instanceof z.ZodOptional || schema instanceof z.ZodNullable ? heldSchema(schema.unwrap() as z.ZodType) : schema;
}

/** Whether a domain's products hold a list of records or a count: an array of objects or records, or a total with whether it is a floor. */
function holdsList(schema: z.ZodType): boolean {
	const held = heldSchema(schema);
	if (!(held instanceof z.ZodObject)) return false;
	const shape: Record<string, z.ZodType> = held.shape;
	if ("total" in shape && "saturated" in shape) return true;
	return Object.values(shape).some((field) => {
		const array = heldSchema(field);
		if (!(array instanceof z.ZodArray)) return false;
		const element = heldSchema(array.element as z.ZodType);
		return element instanceof z.ZodObject || element instanceof z.ZodRecord;
	});
}

/** Each step whose products domain, as its stepper's concerns declare it, holds a list of records or a count without a list
 *  declaration, so a combinator can't read its list. */
export function undeclaredLists(steppers: readonly { stepper: AStepper }[], steps: readonly TDeclaredStep[]): TFound[] {
	const definitions = new Map<string, TDomainDefinition>();
	for (const { stepper } of steppers)
		for (const definition of hasCycles(stepper) ? (stepper.cycles.getConcerns?.().domains ?? []) : [])
			for (const selector of definition.selectors) definitions.set(selector, definition);
	return steps.flatMap((s) =>
		s.productsDomains
			.filter((name) => {
				const definition = definitions.get(name);
				return definition !== undefined && definition.list === undefined && holdsList(definition.schema);
			})
			.map((name) => ({ file: s.file, finding: `${UNDECLARED_LIST}: ${s.stepper}.${s.key} (${name})` })),
	);
}

/** The calls that state steps: resolving a statement's line, and calling a step's action. */
const STATING_CALL = /^(?:findFeatureStepsFromStatement|.*\.steps\.\w+\.action)$/;

/** Whether an argument is fixed: a literal, or an object or array of literals. */
function fixedArgument(node: ts.Expression): boolean {
	if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return true;
	if (ts.isArrayLiteralExpression(node)) return node.elements.every(fixedArgument);
	if (ts.isObjectLiteralExpression(node)) return node.properties.every((p) => ts.isPropertyAssignment(p) && fixedArgument(p.initializer));
	return false;
}

/** Each step of a stepper source whose action ignores its input and states other steps with fixed arguments, which is a waypoint
 *  of a module's library rather than a step. */
export function fixedStatements(repository: string, steps: readonly TDeclaredStep[]): TFound[] {
	const byFile = Map.groupBy(steps, (s) => s.file);
	return [...byFile].flatMap(([file, declared]) => {
		const source = ts.createSourceFile(file, readFileSync(join(repository, file), "utf-8"), ts.ScriptTarget.Latest, true);
		const keys = new Set(declared.map((s) => s.key));
		const found: TFound[] = [];
		const visit = (node: ts.Node): void => {
			if (ts.isPropertyAssignment(node) && keys.has(node.name.getText(source)) && ts.isObjectLiteralExpression(node.initializer)) {
				const action = node.initializer.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(source) === "action");
				const fn = action?.initializer;
				if (fn !== undefined && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ignoresInput(fn) && statesFixed(fn, source))
					found.push({ file, finding: `${FIXED_STATEMENT}: ${declared.find((s) => s.key === node.name.getText(source))?.stepper}.${node.name.getText(source)}` });
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
		return found;
	});
}

/** Whether an action ignores its input: its first parameter is absent, an empty pattern, or a name that starts with an underscore. */
const ignoresInput = (fn: ts.ArrowFunction | ts.FunctionExpression): boolean => {
	const [first] = fn.parameters;
	return first === undefined || (ts.isObjectBindingPattern(first.name) && first.name.elements.length === 0) || (ts.isIdentifier(first.name) && first.name.text.startsWith("_"));
};

/** Whether an action states a step, and every step it states, with fixed arguments. */
function statesFixed(fn: ts.ArrowFunction | ts.FunctionExpression, source: ts.SourceFile): boolean {
	const calls: ts.CallExpression[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && STATING_CALL.test(node.expression.getText(source))) calls.push(node);
		ts.forEachChild(node, visit);
	};
	visit(fn.body);
	return calls.length > 0 && calls.every((call) => call.arguments.length > 0 && fixedArgument(call.arguments[0] as ts.Expression));
}

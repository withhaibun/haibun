/**
 * Three rules of a repository's steps, read from its steppers and from the features and the code that call them. A step that
 * starts or keeps something and doesn't return a product takes a parameter, since a stepper starts what each feature needs as
 * the feature starts, where an option states it (lifecycle). A step has more than one call site, since what one feature alone states is a waypoint of that
 * feature or of a module's library (one call site). A step's pattern isn't another step's with a word more or less, since one
 * primitive takes the difference as a parameter (near-duplicate).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { AStepper } from "../steps/domains/stepper.js";
import { namedInterpolation } from "../steps/derivations/named-vars.js";
import { constructorName, dePolite } from "../domains/util.js";
import type { TFound } from "./baseline.js";
import { sourceFiles, TEST_MODULE } from "./repository-files.js";

export const STARTS_WITHOUT_PARAMETERS = "starts or keeps something without a parameter";
export const ONE_CALL_SITE = "has at most one call site";
export const NEAR_DUPLICATE = "states another step's pattern with a word more or less";

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
			const products = step.productsDomain !== undefined || step.productsDomains !== undefined;
			return [{ file, stepper: declaredBy, key, kind, pattern, parameters: pattern.includes("{"), read: step.read === true, products, precludes: step.precludes ?? [] }];
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

/** What each feature source of a repository states. */
function statedInFeatures(repository: string, files: readonly string[]): TStated {
	const stated = files
		.filter((file) => FEATURE_SOURCE.test(file))
		.map((file): TStated => {
			const text = readFileSync(join(repository, file), "utf-8");
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

/** The ends of a line that a statement nested in it can state: the line, and its text after each space. */
const endsOf = (line: string): string[] => [line, ...[...line.matchAll(/ /g)].map((space) => line.slice((space.index ?? 0) + 1))];

/** How many lines state each step, by its stepper and key: a line states a step where the step's pattern matches the line or
 *  the end of it that follows a space, which is where a statement nested in the line is stated. */
function linesStating(steps: readonly TDeclaredStep[], lines: readonly string[]): Map<TDeclaredStep, number> {
	const compiled = steps.map((step) => ({ step, matches: matcherOf(step) }));
	const byWord = new Map<string, typeof compiled>();
	const unworded: typeof compiled = [];
	for (const c of compiled) {
		const first = /^[a-z][\w'-]*/i.exec(c.step.pattern)?.[0]?.toLowerCase();
		if (first === undefined || c.step.pattern.startsWith(`${first}(`)) unworded.push(c);
		else byWord.set(first, [...(byWord.get(first) ?? []), c]);
	}
	const counts = new Map<TDeclaredStep, number>();
	for (const line of lines)
		for (const end of endsOf(line)) {
			const stated = dePolite(end);
			const word = /^[^\s]+/.exec(stated)?.[0]?.toLowerCase() ?? "";
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
/** An expression that only states the type of the expression it holds. */
const typed = (node: ts.Expression): ts.Expression =>
	ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) ? typed(node.expression) : node;

/** Each naming of a step in the initializer of a top-level constant of a source, with the name code reads it through: the
 *  constant, or the constant and the property of its object that holds the naming, and the statement that declares it. */
function constantNamings(file: string, text: string, keys: ReadonlySet<string>): { key: string; read: string; declaration: string }[] {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	return source.statements.filter(ts.isVariableStatement).flatMap((statement) =>
		statement.declarationList.declarations.flatMap((declaration) => {
			if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return [];
			const constant = declaration.name.text;
			const object = typed(declaration.initializer);
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

/** How many times the code of a repository, apart from each step's own stepper and the tests, calls each step: each naming of
 *  its key in a string or a property access, or after its stepper's name and a dash, as a call over RPC names it. A naming in
 *  the initializer of a top-level constant calls the step wherever code reads the constant, or the property of it that holds
 *  the naming, such as each call a page makes through the constant that names a step's method. */
function codeNaming(repository: string, files: readonly string[], steps: readonly TDeclaredStep[]): Map<TDeclaredStep, number> {
	const keys = new Set(steps.map((s) => s.key));
	const code = files
		.filter((f) => SOURCE.test(f) && !TEST_MODULE.test(f) && !FEATURE_SOURCE.test(f))
		.map((file) => ({ file, text: readFileSync(join(repository, file), "utf-8") }));
	const reads = namesRead(code.map(({ text }) => text));
	const named = new Map<string, Map<string, number>>();
	for (const { file, text } of code) {
		const counts = new Map<string, number>();
		for (const [, key] of text.matchAll(/["'`.-]([A-Za-z]\w*)\b/g)) if (key !== undefined && keys.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
		for (const { key, read, declaration } of constantNamings(file, text, keys)) {
			const elsewhere = (reads.get(read) ?? 0) - (namesRead([declaration]).get(read) ?? 0);
			counts.set(key, (counts.get(key) ?? 0) + Math.max(1, elsewhere) - 1);
		}
		named.set(file, counts);
	}
	return new Map(steps.map((step) => [step, [...named].filter(([file]) => file !== step.file).reduce((sum, [, counts]) => sum + (counts.get(step.key) ?? 0), 0)]));
}

/** Each step with at most one call site: lines of features that state it, kireji calls of it, and the code that names it. */
export function oneCallSite(repository: string, steps: readonly TDeclaredStep[]): TFound[] {
	const files = repositoryFiles(repository);
	const { lines, calls } = statedInFeatures(repository, files);
	const stating = linesStating(steps, lines);
	const naming = codeNaming(repository, files, steps);
	return steps
		.filter((step) => (stating.get(step) ?? 0) + calls.filter((key) => key === step.key).length + (naming.get(step) ?? 0) <= 1)
		.map((step) => ({ file: step.file, finding: `${ONE_CALL_SITE}: ${step.stepper}.${step.key}` }));
}

/**
 * The persisted types and fields a view names, where it reads them from the concern catalog instead. A view names a type
 * by its label as a string, or through an imported const that holds the label. It names a field by a compound field name
 * as a string, a property read or a destructured binding, or through an imported const that holds the name. A field named
 * by one word, such as `id` or `content`, names a property of objects that aren't records too, so the scan doesn't read
 * it. A read of the element's own property or state doesn't read a record's field.
 */
import ts from "typescript";
import type { TFound } from "@haibun/core/lib/test/baseline.js";
import type { TConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { lineOf, parsedSource, resolvedSource, type TPackages } from "@haibun/core/lib/test/repository-files.js";

/** A word in the form of a type's label, such as `Comment` or `SeqPath`. */
const LABEL_FORM = /^[A-Z][a-z\d]+(?:[A-Z][a-z\d]*)*$/;
/** The modules whose functions read a type by its label. */
const TYPE_READERS = /controllers\/(catalog|registry)-controller\.js$/;
/** The keys of a query that name a type. */
const QUERY_TYPE_KEYS = new Set(["label", "persistedAs"]);
/** The key of an object that holds a query. */
const QUERY = "query";
/** A field name that joins words in camel case, such as `generatedAtTime`. */
const COMPOUND = /^[a-z][a-z\d]*[A-Z]/;
/** The property of a ShuElement that holds its state. */
const STATE = "state";

/** The names a catalog supplies: each persisted type's label, and each field named by a compound term. */
export type TCatalogNames = { types: ReadonlySet<string>; fields: ReadonlySet<string> };
type TViewScope = { files: readonly string[]; packages: TPackages; names: TCatalogNames };

export function catalogNames(catalog: TConcernCatalog): TCatalogNames {
	const concerns = Object.values(catalog.persisted);
	const fields = concerns.flatMap((concern) => [...Object.keys(concern.properties), ...Object.keys(concern.edges)]).filter((field) => COMPOUND.test(field));
	return { types: new Set(Object.keys(catalog.persisted)), fields: new Set(fields) };
}

/** The finding a name is, where the catalog supplies it. */
function named(names: TCatalogNames, name: string): string | undefined {
	if (names.types.has(name)) return `type ${name}`;
	return names.fields.has(name) ? `field ${name}` : undefined;
}

/** Whether an expression is the element itself or its state. */
const isOwn = (expression: ts.Expression): boolean =>
	expression.kind === ts.SyntaxKind.ThisKeyword ||
	(ts.isPropertyAccessExpression(expression) && expression.expression.kind === ts.SyntaxKind.ThisKeyword && expression.name.text === STATE);

/** Whether a string names a module: a static or dynamic import, a re-export, or an import type. */
const isModuleSpecifier = (node: ts.Node): boolean => {
	const { parent } = node;
	if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
	if (ts.isLiteralTypeNode(parent)) return ts.isImportTypeNode(parent.parent);
	return ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword;
};

/** The string value of each const a module exports, by its exported name. */
function exportedStrings(source: ts.SourceFile): Map<string, string> {
	const strings = new Map<string, string>();
	for (const statement of source.statements) {
		if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
		for (const declaration of statement.declarationList.declarations) {
			const value = declaration.initializer && ts.isAsExpression(declaration.initializer) ? declaration.initializer.expression : declaration.initializer;
			if (ts.isIdentifier(declaration.name) && value !== undefined && ts.isStringLiteralLike(value)) strings.set(declaration.name.text, value.text);
		}
	}
	return strings;
}

/** The finding each local name of a value import is, where the module exports it as a string the catalog supplies. */
function importedNames(repository: string, file: string, source: ts.SourceFile, { packages, names }: TViewScope): Map<string, string> {
	const found = new Map<string, string>();
	for (const statement of source.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
		const bindings = statement.importClause?.namedBindings;
		if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
		const target = resolvedSource(repository, file, statement.moduleSpecifier.text, packages);
		if (target === undefined) continue;
		const strings = exportedStrings(parsedSource(repository, target));
		for (const element of bindings.elements) {
			const value = strings.get((element.propertyName ?? element.name).text);
			const finding = element.isTypeOnly || value === undefined ? undefined : named(names, value);
			if (finding !== undefined) found.set(element.name.text, finding);
		}
	}
	return found;
}

/** The label-form string each local const holds, by the const's name. */
function labelConsts(source: ts.SourceFile): Map<string, string> {
	const labels = new Map<string, string>();
	const visit = (node: ts.Node): void => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.initializer !== undefined &&
			ts.isStringLiteralLike(node.initializer) &&
			LABEL_FORM.test(node.initializer.text)
		)
			labels.set(node.name.text, node.initializer.text);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return labels;
}

/** The local names of the functions a view imports from a module that reads a type by its label. */
function typeReaders(source: ts.SourceFile): Set<string> {
	const readers = new Set<string>();
	for (const statement of source.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !TYPE_READERS.test(statement.moduleSpecifier.text)) continue;
		const bindings = statement.importClause?.namedBindings;
		if (bindings !== undefined && ts.isNamedImports(bindings)) for (const element of bindings.elements) readers.add(element.name.text);
	}
	return readers;
}

/** Whether an expression is in a type's position: an argument of a function that reads a type by its label, or the type
 *  a query names. */
function inTypePosition(node: ts.Expression, readers: ReadonlySet<string>): boolean {
	const { parent } = node;
	if (ts.isCallExpression(parent) && parent.arguments.includes(node)) return ts.isIdentifier(parent.expression) && readers.has(parent.expression.text);
	if (!ts.isPropertyAssignment(parent) || parent.initializer !== node || !ts.isIdentifier(parent.name) || !QUERY_TYPE_KEYS.has(parent.name.text)) return false;
	const holder = parent.parent.parent;
	return ts.isPropertyAssignment(holder) && ts.isIdentifier(holder.name) && holder.name.text === QUERY;
}

/** The finding a label in a type's position is, where the catalog doesn't declare it: a type a consumer declares, which
 *  haibun doesn't name. */
function undeclared(names: TCatalogNames, label: string | undefined): string | undefined {
	return label === undefined || names.types.has(label) ? undefined : `undeclared type ${label}`;
}

/** Each type and field each view names, at its line. */
export function catalogNameFindings(repository: string, scope: TViewScope): TFound[] {
	return scope.files.flatMap((file) => {
		const source = parsedSource(repository, file);
		const imported = importedNames(repository, file, source, scope);
		const labels = labelConsts(source);
		const readers = typeReaders(source);
		const found: TFound[] = [];
		const add = (node: ts.Node, finding: string | undefined): void => {
			if (finding !== undefined) found.push({ file, finding, line: lineOf(node) });
		};
		const visit = (node: ts.Node): void => {
			if ((ts.isStringLiteralLike(node) || ts.isIdentifier(node)) && inTypePosition(node, readers))
				add(node, undeclared(scope.names, ts.isIdentifier(node) ? labels.get(node.text) : LABEL_FORM.test(node.text) ? node.text : undefined));
			if (ts.isStringLiteralLike(node) && !isModuleSpecifier(node)) add(node, named(scope.names, node.text));
			else if (ts.isPropertyAccessExpression(node) && !isOwn(node.expression)) add(node.name, named(scope.names, node.name.text));
			else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
				const key = node.propertyName ?? node.name;
				const declaration = node.parent.parent;
				const fromOwn = ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined && isOwn(declaration.initializer);
				if (ts.isIdentifier(key) && !fromOwn) add(key, named(scope.names, key.text));
			} else if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
				add(node, imported.get(node.text));
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
		return found;
	});
}

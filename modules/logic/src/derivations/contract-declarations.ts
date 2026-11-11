/**
 * The predicate registry's check of the steps' contracts. A contract's statements name relations, which the steppers declare
 * once in their concerns; parameters, which the step's pattern names; and fields, which a declared record type's schema holds.
 * A finding is a statement whose relation the steppers don't declare or whose arguments don't match its arity, a parameter the pattern
 * doesn't name, a derived record of a type the steppers don't declare, and a field of a statement, `changes` or `complete` that the declared types' schemas don't hold.
 * A relation's phrases render each statement as a sentence, and a finding is a relation whose sentence doesn't parse back to its statement's term.
 */
import { unwrapToShape } from "@haibun/core/lib/domains/zod-unwrap.js";
import { hasCycles, type AStepper } from "@haibun/core/lib/steps/domains/stepper.js";
import { doesntHold, holds, parameter, type TContractArgument, type TField, type TRelation, type TStatement } from "@haibun/core/lib/steps/domains/contract.js";
import { phraseParts, stepParts } from "@haibun/core/lib/steps/domains/phrase.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { declaredSteps, sentenceTerm, statementSentence, statementTerm } from "@haibun/core/lib/steps/derivations/predicate-registry.js";
import { termText } from "./registry.js";

export type TContractFinding = { method: string; finding: string };

export const UNDECLARED_RELATION =
	"states a relation that the steppers don't declare in their concerns. Declare the relation once in the concerns of the stepper whose rules state it";
export const ARITY = "applies a relation to a number of arguments other than its arity. Give the statement one argument for each place of the relation";
export const UNNAMED_PARAMETER = "names a parameter its pattern doesn't. Name a placeholder of the step's pattern";
export const UNDECLARED_TYPE = "derives a record of a type that the steppers don't declare. Derive a record of a type a stepper declares in its concerns";
export const UNDECLARED_FIELD = "names a field that the declared record types' schemas don't hold. Build the field with `field` from the type's declaration";
export const UNPARSED_SENTENCE =
	"renders a statement as a sentence that the relations' phrases don't parse back to its term. Give the relation's two phrases the same placeholders, each worded so that it parses only its own sentences";

/** The places of a relation, by the placeholders of its phrase. */
const placesOf = (relation: TRelation): string[] => phraseParts(relation.phrase.holds).map(({ name }) => name);

/** Returns the findings of the relations' phrases: a relation whose two phrases name other places, or a statement over its places,
 *  held or not, whose sentence doesn't parse back to its term through the relations' phrases. */
export function relationFindings(relations: readonly TRelation[]): TContractFinding[] {
	return relations.flatMap((relation) => {
		const places = placesOf(relation);
		const statements = [holds, doesntHold].map((form) => form(relation, ...places.map(parameter)));
		const parsed = (statement: TStatement): boolean => {
			const term = sentenceTerm(relations, statementSentence(statement));
			return term !== undefined && termText(term) === termText(statementTerm(statement));
		};
		const same =
			places.join() ===
			phraseParts(relation.phrase.doesntHold)
				.map(({ name }) => name)
				.join();
		return same && statements.every(parsed) ? [] : [{ method: relation.name, finding: UNPARSED_SENTENCE }];
	});
}

/** The keys of each record type the steppers declare, by its stored label, read through the wrappers of its schema, such as
 *  the preprocess of a schema that reads JSON text. */
function declaredFields(steppers: readonly AStepper[]): Map<string, ReadonlySet<string>> {
	return new Map(
		steppers.flatMap((stepper) => {
			const domains = hasCycles(stepper) ? stepper.cycles.getConcerns?.().domains : undefined;
			return (domains === undefined ? [] : domains).flatMap(({ schema, topology }) => {
				const shape = unwrapToShape(schema);
				return topology?.persistedAs === undefined || shape === null ? [] : [[topology.persistedAs, new Set(Object.keys(shape))] as const];
			});
		}),
	);
}

/** The relations the steppers declare in their concerns. */
export function declaredRelations(steppers: readonly AStepper[]): ReadonlySet<TRelation> {
	return new Set(
		steppers.flatMap((stepper) => {
			const relations = hasCycles(stepper) ? stepper.cycles.getConcerns?.().relations : undefined;
			return relations === undefined ? [] : relations;
		}),
	);
}

/** Returns the findings of each step's contract. */
export function contractFindings(steppers: readonly AStepper[]): TContractFinding[] {
	const fields = declaredFields(steppers);
	const relations = declaredRelations(steppers);
	const fieldFindings = (fieldOf: TField): string[] =>
		fields.get(fieldOf.persistedAs)?.has(fieldOf.key) === true ? [] : [`${UNDECLARED_FIELD} (${fieldOf.persistedAs}.${fieldOf.key})`];
	const stepFindings = declaredSteps(steppers).flatMap(({ stepperName, actionName, step }) => {
		const { contract } = step;
		if (contract === undefined) return [];
		const named = new Set(stepParts(step).map(({ name }) => name));
		const argumentFindings = (argument: TContractArgument): string[] => {
			if ("parameter" in argument) return named.has(argument.parameter) ? [] : [`${UNNAMED_PARAMETER} ({${argument.parameter}})`];
			if ("products" in argument || "principal" in argument) return [];
			if ("derived" in argument)
				return [...(fields.has(argument.derived.persistedAs) ? [] : [`${UNDECLARED_TYPE} (${argument.derived.persistedAs})`]), ...argument.derived.args.flatMap(argumentFindings)];
			return fieldFindings(argument);
		};
		const statementFindings = ({ relation, args }: TStatement): string[] => [
			...(relations.has(relation) ? [] : [`${UNDECLARED_RELATION} (${relation.name})`]),
			...(args.length === placesOf(relation).length ? [] : [`${ARITY} (${relation.name} takes ${placesOf(relation).length}, and the statement gives ${args.length})`]),
			...args.flatMap(argumentFindings),
		];
		const statements = [...(contract.states === undefined ? [] : contract.states), ...(contract.requires === undefined ? [] : contract.requires)];
		const fieldsNamed = [...(contract.changes === undefined ? [] : contract.changes), ...(contract.complete === undefined ? [] : contract.complete)];
		const method = stepMethodName(stepperName, actionName);
		return [...statements.flatMap(statementFindings), ...fieldsNamed.flatMap(fieldFindings)].map((finding) => ({ method, finding }));
	});
	return [...stepFindings, ...relationFindings([...relations])];
}

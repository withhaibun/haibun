/**
 * The predicate registry's check of the steps' contracts. A contract's statements name relations, which the steppers declare
 * once in their concerns; parameters, which the step's pattern names; and fields, which a declared record type's schema holds.
 * A finding is a statement whose relation the steppers don't declare or whose arguments don't match its arity, a parameter the pattern
 * doesn't name, and a field of a statement, `changes` or `complete` that the declared types' schemas don't hold.
 */
import { unwrapToShape } from "@haibun/core/lib/domains/zod-unwrap.js";
import { hasCycles, type AStepper } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TContractArgument, TField, TRelation, TStatement } from "@haibun/core/lib/steps/domains/contract.js";
import { stepParts } from "@haibun/core/lib/steps/domains/phrase.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { declaredSteps } from "@haibun/core/lib/steps/derivations/predicate-registry.js";

export type TContractFinding = { method: string; finding: string };

export const UNDECLARED_RELATION =
	"states a relation that the steppers don't declare in their concerns. Declare the relation once in the concerns of the stepper whose rules state it";
export const ARITY = "applies a relation to a number of arguments other than its arity. Give the statement one argument for each place of the relation";
export const UNNAMED_PARAMETER = "names a parameter its pattern doesn't. Name a placeholder of the step's pattern";
export const UNDECLARED_FIELD = "names a field that the declared record types' schemas don't hold. Build the field with `field` from the type's declaration";

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
	return declaredSteps(steppers).flatMap(({ stepperName, actionName, step }) => {
		const { contract } = step;
		if (contract === undefined) return [];
		const named = new Set(stepParts(step).map(({ name }) => name));
		const argumentFindings = (argument: TContractArgument): string[] => {
			if ("parameter" in argument) return named.has(argument.parameter) ? [] : [`${UNNAMED_PARAMETER} ({${argument.parameter}})`];
			if ("products" in argument || "principal" in argument) return [];
			return fieldFindings(argument);
		};
		const statementFindings = ({ relation, args }: TStatement): string[] => [
			...(relations.has(relation) ? [] : [`${UNDECLARED_RELATION} (${relation.name})`]),
			...(args.length === relation.arity ? [] : [`${ARITY} (${relation.name} takes ${relation.arity}, and the statement gives ${args.length})`]),
			...args.flatMap(argumentFindings),
		];
		const statements = [...(contract.states === undefined ? [] : contract.states), ...(contract.requires === undefined ? [] : contract.requires)];
		const fieldsNamed = [...(contract.changes === undefined ? [] : contract.changes), ...(contract.complete === undefined ? [] : contract.complete)];
		const method = stepMethodName(stepperName, actionName);
		return [...statements.flatMap(statementFindings), ...fieldsNamed.flatMap(fieldFindings)].map((finding) => ({ method, finding }));
	});
}

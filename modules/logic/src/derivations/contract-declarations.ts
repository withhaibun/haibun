/**
 * The predicate registry's check of the steps' contracts. A contract's statements name relations, which the steppers declare
 * once in their concerns; parameters, which the step's pattern names; and fields, which a declared record type's schema holds.
 * A finding is a statement whose relation the steppers don't declare or whose arguments don't match its arity, a parameter the pattern
 * doesn't name, a derived record of a type the steppers don't declare, a field of a statement, `changes` or `complete` that the declared types' schemas don't hold,
 * and a relation `changes` lists that statements don't name.
 * A relation's phrases render each statement as a sentence, and a finding is a relation whose sentence doesn't parse back to its statement's term.
 */
import { unwrapToShape } from "@haibun/core/lib/domains/zod-unwrap.js";
import { hasCycles, type AStepper } from "@haibun/core/lib/steps/domains/stepper.js";
import { isPersisted } from "@haibun/core/lib/domains/resources.js";
import {
	doesntHold,
	holds,
	isRecordChange,
	parameter,
	requiredRelation,
	type TChange,
	type TContractArgument,
	type TField,
	type TRelation,
	type TStatement,
} from "@haibun/core/lib/steps/domains/contract.js";
import { statementPredicates } from "@haibun/core/lib/steps/derivations/statement-predicates.js";
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
export const UNDECLARED_RECORD_CHANGE = "lists a change of every record of a type that the steppers don't declare. List a type a stepper declares in its concerns";
export const UNSTATED_RELATION = "lists a change of a relation that statements don't name. List a field of a type, or a relation of `statementPredicates`";
export const UNPARSED_SENTENCE =
	"renders a statement as a sentence that the relations' phrases don't parse back to its term. Word the relation's phrase so that it parses only its own sentences, and another relation's phrase doesn't parse them";

/** The places of a relation, by the placeholders of its phrase. */
const placesOf = (relation: TRelation): string[] => phraseParts(relation.phrase).map(({ name }) => name);

/** Returns the findings of the relations' phrases: a statement over a relation's places, held or negated, whose sentence doesn't
 *  parse back to its term through the relations' phrases. */
export function relationFindings(relations: readonly TRelation[]): TContractFinding[] {
	return relations.flatMap((relation) => {
		const places = placesOf(relation);
		const statements = [holds, doesntHold].map((form) => form(relation, ...places.map(parameter)));
		const parsed = (statement: TStatement): boolean => {
			const term = sentenceTerm(relations, statementSentence(statement));
			return term !== undefined && termText(term) === termText(statementTerm(statement));
		};
		return statements.every(parsed) ? [] : [{ method: relation.name, finding: UNPARSED_SENTENCE }];
	});
}

/** The keys of each record type the steppers declare, by its stored label, read through the wrappers of its schema, such as
 *  the preprocess of a schema that reads JSON text, and the fields of the type's declared edges. A store reads a write's change of
 *  an edge field as a change of that field, so `changes` lists it as a field; a statement reads only the schema's keys. */
function declaredFields(steppers: readonly AStepper[]): { schemas: Map<string, ReadonlySet<string>>; edges: Map<string, ReadonlySet<string>> } {
	const types = steppers.flatMap((stepper) => {
		const domains = hasCycles(stepper) ? stepper.cycles.getConcerns?.().domains : undefined;
		return (domains === undefined ? [] : domains).flatMap(({ schema, topology }) => {
			const shape = unwrapToShape(schema);
			return topology?.persistedAs === undefined || shape === null
				? []
				: [{ type: topology.persistedAs, keys: Object.keys(shape), edges: topology.edges === undefined ? [] : Object.keys(topology.edges) }];
		});
	});
	return { schemas: new Map(types.map(({ type, keys }) => [type, new Set(keys)])), edges: new Map(types.map(({ type, edges }) => [type, new Set(edges)])) };
}

/** The relation of each field a record type the steppers declare states every member has (`required`), once for each key. */
function requiredRelations(steppers: readonly AStepper[]): TRelation[] {
	const keys = steppers.flatMap((stepper) => {
		const domains = hasCycles(stepper) ? stepper.cycles.getConcerns?.().domains : undefined;
		return (domains === undefined ? [] : domains).flatMap(({ topology }) => (isPersisted(topology) && topology.required !== undefined ? topology.required : []));
	});
	return [...new Set(keys)].map(requiredRelation);
}

/** The relations a contract's check reads: those the steppers declare, and the relation of each field their types require. */
export const checkedRelations = (steppers: readonly AStepper[]): TRelation[] => [...declaredRelations(steppers), ...requiredRelations(steppers)];

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
	const { schemas: fields, edges } = declaredFields(steppers);
	const relations = declaredRelations(steppers);
	const predicates = new Set(statementPredicates());
	const fieldFindings = (fieldOf: TField): string[] =>
		fields.get(fieldOf.persistedAs)?.has(fieldOf.key) === true ? [] : [`${UNDECLARED_FIELD} (${fieldOf.persistedAs}.${fieldOf.key})`];
	const changedFieldFindings = (fieldOf: TField): string[] => (edges.get(fieldOf.persistedAs)?.has(fieldOf.key) === true ? [] : fieldFindings(fieldOf));
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
		const changeFindings = (change: TChange): string[] => {
			if (isRecordChange(change)) return fields.has(change.persistedAs) ? [] : [`${UNDECLARED_RECORD_CHANGE} (${change.persistedAs})`];
			return "persistedAs" in change ? changedFieldFindings(change) : predicates.has(change.relation) ? [] : [`${UNSTATED_RELATION} (${change.relation})`];
		};
		const changes = [...(contract.changes === undefined ? [] : contract.changes), ...(contract.complete === undefined ? [] : contract.complete)];
		const method = stepMethodName(stepperName, actionName);
		return [...statements.flatMap(statementFindings), ...changes.flatMap(changeFindings)].map((finding) => ({ method, finding }));
	});
	return [...stepFindings, ...relationFindings([...relations])];
}

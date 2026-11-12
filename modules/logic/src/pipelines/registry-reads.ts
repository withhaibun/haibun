/**
 * Reads of a proof and of the predicate registry for the logic stepper's steps: a statement's or a recorded step's derivation
 * from the records its proof wrote, a line's term and the line it renders as, the term of a call a transport carries, and the refusal of steppers
 * from whose declarations the registry doesn't derive each step once.
 */
import type { DispatchContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { nextSeqPath, proveStep } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { Resolver } from "@haibun/core/lib/actuality/pipelines/resolver.js";
import { runRegistry } from "@haibun/core/lib/steps/pipelines/step-registry.js";
import { mapInputToStepValues } from "@haibun/core/lib/steps/derivations/named-vars.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD, calledParts, actualityFeatureOf, formatRecordName, parseRecordName, type TRecordName } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { constructorName } from "@haibun/core/lib/domains/util.js";
import type { TWorld } from "@haibun/core/lib/actuality/domains/world.js";
import type { AStepper, TFeatureStep } from "@haibun/core/lib/steps/domains/stepper.js";
import { derivationOf } from "../derivations/derivation.js";
import { termText } from "../derivations/registry.js";
import { declaredSteps, lineOfTerm, predicateOf, predicatesOf, termOfAction, type TLineTerm } from "@haibun/core/lib/steps/derivations/predicate-registry.js";
import type { TDerivation } from "../domains/logic.js";
import type { TIndividualAddress } from "@haibun/core/lib/domains/typed-links.js";
import { declarationFindings } from "../derivations/declarations.js";
import { recordsWhere } from "./reads.js";
import { contractProofs } from "./contract-checks.js";
import { declaredRelations } from "../derivations/contract-declarations.js";
import { proofFrames } from "../derivations/proof-frames.js";
import type { TReasoner } from "../ports.js";

/** Whether a record's call is of a step the engine proves by its reading, and so a node of a proof. */
const isNodeOf =
	(steppers: AStepper[]) =>
	(called: string | undefined): boolean => {
		if (called === undefined) return false;
		const { stepperName, actionName } = calledParts(called);
		return steppers.find((one) => constructorName(one) === stepperName)?.steps[actionName]?.reading !== undefined;
	};

/** Returns the derivation of the step whose record `name` names, from the records its proof wrote in its actuality feature, with
 *  EYE's proof of each check of its contract, which EYE proves from the facts the record states each check read. */
async function derivationRecorded(world: TWorld, steppers: AStepper[], reasoner: TReasoner, name: TRecordName): Promise<TDerivation> {
	const records = await recordsWhere(world.shared.getStore(), SEQ_PATH_LABEL, SEQ_PATH_FIELD.actuality, name.actuality);
	const id = formatRecordName(name);
	const checks = records.find((record) => record[SEQ_PATH_FIELD.id] === id)?.[SEQ_PATH_FIELD.contract];
	const proofs = typeof checks === "string" ? await contractProofs([...declaredRelations(steppers)], reasoner, checks) : [];
	return derivationOf(records, id, isNodeOf(steppers), proofFrames(proofs, { persistedAs: SEQ_PATH_LABEL, id }));
}

/** Proves a statement under a step, and returns its derivation from the records its proof wrote. */
export async function derivationUnder(ctx: DispatchContext, reasoner: TReasoner, parent: TFeatureStep, statement: TFeatureStep): Promise<TDerivation> {
	const { world, steppers } = ctx;
	const seqPath = nextSeqPath(world, parent.seqPath);
	await proveStep(ctx, { ...statement, seqPath, isSubStep: true, ...(parent.runtimeArgs === undefined ? {} : { runtimeArgs: parent.runtimeArgs }) });
	return derivationRecorded(world, steppers, reasoner, { actuality: actualityFeatureOf(world.tag), path: seqPath });
}

/** Returns the derivation of the step whose record `step` addresses, read from the records its proof wrote, without proving it again. */
export function derivationOfRecord(world: TWorld, steppers: AStepper[], reasoner: TReasoner, step: TIndividualAddress): Promise<TDerivation> {
	const name = step.persistedAs === SEQ_PATH_LABEL ? parseRecordName(step.id) : undefined;
	if (name === undefined)
		throw new Error(`${step.persistedAs} ${step.id} isn't a step's record. Address a ${SEQ_PATH_LABEL} record by its id, its actuality feature and its path.`);
	return derivationRecorded(world, steppers, reasoner, name);
}

/** The term of the step a line resolves to, through the pattern that parses the line: the head of the waypoint the line
 *  applies, or the step's own pattern. The functor of a line that applies a waypoint is the waypoint's head. */
function resolvedTerm(world: TWorld, resolver: Resolver, line: string): { term: TLineTerm; pattern: string } {
	const { stepperName, actionName, step, stepValuesMap } = resolver.findSingleStepAction(line);
	const { rule, gwta } = step;
	const pattern = rule === undefined ? gwta : rule.pattern;
	if (pattern === undefined)
		throw new Error(`\`${line}\` resolves to ${stepperName}.${actionName}, which states an exact line rather than a pattern to render. Give the step a pattern.`);
	const functor = rule === undefined ? predicateOf({ stepperName, actionName, step }) : rule.head;
	return { term: termOfAction(functor, stepValuesMap, pattern, world.domains), pattern };
}

/** A line's term through the step it resolves to, as text, and the line the term renders as. */
export function lineTerm(world: TWorld, steppers: AStepper[], line: string): { term: string; rendered: string } {
	const { term, pattern } = resolvedTerm(world, new Resolver(steppers, []), line);
	return { term: termText(term), rendered: lineOfTerm(pattern, term, world.domains) };
}

/** The term of a call a transport carries: a method with its named parameters, as text. A step another host runs proves that
 *  host's predicate, so its call doesn't have a term here. */
export function callTerm(world: TWorld, method: string, input: Record<string, unknown>): string {
	const { descriptor, stepDef } = runRegistry(world).named(method);
	if (stepDef === undefined) throw new Error(`${method} runs at another host, which holds its term. State a call of a step this process runs.`);
	const functor = predicateOf({ stepperName: descriptor.stepperName, actionName: descriptor.stepName, step: stepDef });
	return termText(termOfAction(functor, mapInputToStepValues(input, input, descriptor.pattern), descriptor.pattern, world.domains));
}

/** Refuses steppers from whose declarations the registry doesn't build, or whose declarations miss a face, repeat a pattern, or
 *  state a pattern whose own line parses two ways. */
export function refuseDeclarations(steppers: AStepper[]): void {
	predicatesOf(declaredSteps(steppers));
	const resolver = new Resolver(steppers, []);
	const findings = declarationFindings(steppers, (line) => resolver.parsedStepAction(line));
	if (findings.length > 0) {
		const listed = findings.map(({ method, finding }) => `${method} ${finding}`).join("; ");
		throw new Error(`Correct each of these step declarations: ${listed}`);
	}
}

/**
 * The predicate registry's check of the steppers' declarations: each step declared once with every face the registry derives
 * from it. A step's faces are its pattern, which parses a line, its functor (an action or a reading), the IRI its method
 * names, and the renderer its pattern gives. A finding is a missing face, a pattern another step declares unless a precludes
 * settles it, a pattern whose own line parses to another step or to more than one, or a parameter whose domain is string.
 */
import type { AStepper, TStepAction, TStepperStep } from "@haibun/core/lib/steps/domains/stepper.js";
import { DOMAIN_STRING, domainParts } from "@haibun/core/lib/domains/domains.js";
import { declaredSteps } from "@haibun/core/lib/steps/derivations/predicate-registry.js";
import { stepParts } from "@haibun/core/lib/steps/domains/phrase.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";

export type TDeclarationFinding = { method: string; finding: string };

export const MISSING_PATTERN = "doesn't declare a pattern, an exact line, prose or rules. Give it a pattern or an exact line.";
export const MISSING_FUNCTOR = "doesn't declare an action or a reading. Give it an action, or a reading the engine proves.";
export const DUPLICATE_PATTERN = "declares the pattern of another step. Change one pattern, or name the other step in precludes.";
export const PARSES_TWO_WAYS = "declares a pattern whose own line doesn't parse to it alone";
/** The remedy of a pattern whose own line parses to another step, or doesn't parse to one step. */
const PARSES_ALONE = "Change the pattern so only this step parses its line, or name the other step in precludes.";
export const STRING_PARAMETER = "takes a parameter whose domain is string, which doesn't state what its value is";

/** A pattern with each placeholder's name and domain left out, so two patterns that parse the same lines compare equal. */
const shapeOf = (step: TStepperStep): string | undefined => (step.gwta === undefined ? step.exact : step.gwta.replace(/\{[^}]*\}/g, "{}").toLowerCase());

/** A line that a pattern states: each placeholder given a quoted term, or a bare one where the pattern quotes it. */
const sampleLine = (gwta: string): string =>
	gwta
		.replace(/\([^)]*\)\?/g, "")
		.replace(/\\(.)/g, "$1")
		.replace(/(")?\{[^}]*\}/g, (_, quoted: string | undefined) => (quoted === undefined ? '"x"' : '"x'));

/** The findings of the steppers' declarations. `resolve` returns the step a line parses to, and throws where it doesn't parse to one. */
export function declarationFindings(steppers: readonly AStepper[], resolve: (line: string) => TStepAction): TDeclarationFinding[] {
	const declared = declaredSteps(steppers);
	const precluded = new Set(declared.flatMap(({ step }) => (step.precludes === undefined ? [] : step.precludes)));
	const byShape = Map.groupBy(
		declared.filter(({ step, stepperName, actionName }) => shapeOf(step) !== undefined && !precluded.has(`${stepperName}.${actionName}`)),
		({ step }) => shapeOf(step),
	);
	return declared.flatMap((one): TDeclarationFinding[] => {
		const method = stepMethodName(one.stepperName, one.actionName);
		const { step } = one;
		if (step.gwta === undefined && step.exact === undefined && step.prose !== true && step.rules === undefined) return [{ method, finding: MISSING_PATTERN }];
		if (step.action === undefined && step.reading === undefined) return [{ method, finding: MISSING_FUNCTOR }];
		if (precluded.has(`${one.stepperName}.${one.actionName}`)) return [];
		const shape = shapeOf(step);
		const peers = shape === undefined ? undefined : byShape.get(shape);
		if (peers !== undefined && peers.length > 1) return [{ method, finding: DUPLICATE_PATTERN }];
		if (step.gwta === undefined) return [];
		const untyped = stepParts(step).flatMap(({ name, domain }) => (domainParts(domain).includes(DOMAIN_STRING) ? [name] : []));
		if (untyped.length > 0) return [{ method, finding: `${STRING_PARAMETER}: ${untyped.join(", ")}. Give each a domain that names its value.` }];
		const line = sampleLine(step.gwta);
		try {
			const parsed = resolve(line);
			return parsed.stepperName === one.stepperName && parsed.actionName === one.actionName
				? []
				: [{ method, finding: `${PARSES_TWO_WAYS}: \`${line}\` parses to ${parsed.stepperName}.${parsed.actionName}. ${PARSES_ALONE}` }];
		} catch {
			return [{ method, finding: `${PARSES_TWO_WAYS}: \`${line}\` doesn't parse to one step. ${PARSES_ALONE}` }];
		}
	});
}

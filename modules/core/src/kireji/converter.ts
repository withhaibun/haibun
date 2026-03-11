import { AStepper } from '../lib/astepper.js';
import { Resolver } from '../phases/Resolver.js';
import { TActionExecutor, TCurriedAction, withAction } from './withAction.js';

// The structure of a kireji feature, using the ActionExecutor for type safety.
// Steps can be either TActionExecutor functions or plain strings (prose)
type TkirejiFeature = {
  [key: string]: (TActionExecutor<string> | string)[];
};

export type TBddWithLineMap = {
  content: string;
  lineMap: Map<number, number>; // bddLineNumber (1-indexed) -> stepIndex (0-indexed in source array)
};

/**
 * Converts a Kireji feature object into a BDD formatted string.
 * It iterates through the feature's steps, executing any functional steps to get their GWTA string,
 * and mapping the resulting lines to the original step indices for source tracking.
 */
export const toBdd = (feature: TkirejiFeature): TBddWithLineMap => {
  let bddString = '';
  const lineMap = new Map<number, number>();
  let currentLine = 1; // 1-indexed line number in output

  for (const featureName in feature) {
    bddString += `Feature: ${featureName}\n`;
    currentLine++; // Feature line doesn't map to a step

    const steps = feature[featureName];

    for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
      const step = steps[stepIdx];
      // Handle both function executors and plain prose strings
      if (typeof step === 'string') {
        bddString += `  ${step}\n`;
      } else {
        const { gwta } = step();
        bddString += `  ${gwta}\n`;
      }
      lineMap.set(currentLine, stepIdx);
      currentLine++;
    }
  }

  return { content: bddString, lineMap };
};

/**
 * Converts a BDD formatted string back into a Kireji feature object.
 * This function parses the string to extract the feature name and steps,
 * then uses the provided steppers to resolve each step prose back to a
 * functional action with arguments.
 */
export const fromBdd = (bdd: string, steppers: AStepper[]): Promise<TkirejiFeature> => {
  const lines = bdd.split('\n');
  const featureName = lines[0].replace('Feature: ', '').trim();
  const steps = lines.slice(1).map(l => l.trim()).filter(l => l.length > 0);

  const resolver = new Resolver(steppers);
  const stepperActions = steppers.map(stepper => withAction(stepper) as unknown as Record<string, TCurriedAction<string>>);

  const kirejiSteps = steps.map(step => {
    const action = resolver.findSingleStepAction(step);
    const { actionName, stepValuesMap } = action;
    const args: { [key: string]: string } = {};
    if (stepValuesMap) {
      for (const key in stepValuesMap) {
        args[key] = stepValuesMap[key].term;
      }
    }

    const actionFunction = stepperActions.reduce<TCurriedAction<string> | undefined>((found, actions) => {
      return found ?? actions[actionName];
    }, undefined);

    if (!actionFunction) {
      throw new Error(`Action "${actionName}" not found in provided steppers.`);
    }
    return actionFunction(args);
  });

  return Promise.resolve({
    [featureName]: kirejiSteps,
  });
}

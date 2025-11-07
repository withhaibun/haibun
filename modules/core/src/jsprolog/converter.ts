import { AStepper } from '../lib/astepper.js';
import { Resolver } from '../phases/Resolver.js';
import { TActionExecutor, TCurriedAction } from './withAction.js';
import { CombinedStepper } from './stepper-utils.js';

// The structure of a jsprolog feature, using the ActionExecutor for type safety.
type TJsPrologFeature = {
  [key: string]: TActionExecutor<string>[];
};

export const toBdd = (feature: TJsPrologFeature): string => {
  let bddString = '';

  for (const featureName in feature) {
    bddString += `Feature: ${featureName}\n`;
    const steps = feature[featureName];

    for (const step of steps) {
      const { gwta } = step();
      bddString += `  ${gwta}\n`;
    }
  }

  return bddString;
};

export const fromBdd = async (bdd: string, steppers: AStepper[]): Promise<TJsPrologFeature> => {
    const lines = bdd.split('\n');
    const featureName = lines[0].replace('Feature: ', '').trim();
    const steps = lines.slice(1).map(l => l.trim()).filter(l => l.length > 0);

    const resolver = new Resolver(steppers);
    const { withAction } = await import('./withAction.js');
    const combinedStepper = new CombinedStepper(steppers);
    combinedStepper.init();
    const actions = withAction(combinedStepper) as { [key: string]: TCurriedAction<string> };

    const jsprologSteps = steps.map(step => {
        const action = resolver.findSingleStepAction(step);
        const { actionName, stepValuesMap } = action;
        const args: { [key: string]: string } = {};
        if (stepValuesMap) {
            for (const key in stepValuesMap) {
                args[key] = stepValuesMap[key].term;
            }
        }
        const actionFunction = actions[actionName];
        if (!actionFunction) {
            throw new Error(`Action "${actionName}" not found in provided steppers.`);
        }
        return actionFunction(args);
    });

    return {
        [featureName]: jsprologSteps,
    };
}

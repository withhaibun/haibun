import { AStepper } from '../lib/astepper.js';
import { Resolver } from '../phases/Resolver.js';
import { TActionExecutor, TCurriedAction, withAction } from './withAction.js';

// The structure of a kireji feature, using the ActionExecutor for type safety.
// Steps can be either TActionExecutor functions or plain strings (prose)
type TkirejiFeature = {
  [key: string]: (TActionExecutor<string> | string)[];
};

export const toBdd = (feature: TkirejiFeature): string => {
  let bddString = '';

  for (const featureName in feature) {
    bddString += `Feature: ${featureName}\n`;
    const steps = feature[featureName];

    for (const step of steps) {
      // Handle both function executors and plain prose strings
      if (typeof step === 'string') {
        bddString += `  ${step}\n`;
      } else {
        const { gwta } = step();
        bddString += `  ${gwta}\n`;
      }
    }
  }

  return bddString;
};

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
				console.log('\\nx', stepValuesMap[key].term);
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

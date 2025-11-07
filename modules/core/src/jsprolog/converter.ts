import { AStepper } from '../lib/astepper.js';
import { Resolver } from '../phases/Resolver.js';

// The structure of a jsprolog feature
type TJsPrologFeature = {
  [key: string]: (() => any)[];
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
    const actions = withAction(new CombinedStepper(steppers));

    const jsprologSteps = steps.map(step => {
        const action = resolver.findSingleStepAction(step);
        const { actionName, stepValuesMap } = action;
        const args = {};
        if (stepValuesMap) {
            for (const key in stepValuesMap) {
                args[key] = stepValuesMap[key].term;
            }
        }
        return actions[actionName](args);
    });

    return {
        [featureName]: jsprologSteps,
    };
}

class CombinedStepper extends AStepper {
    constructor(steppers: AStepper[]) {
        super();
        this.steps = steppers.reduce((acc, stepper) => ({ ...acc, ...stepper.steps }), {});
    }
}

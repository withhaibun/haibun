import { AStepper, TStepperSteps } from '../lib/astepper.js';

export class CombinedStepper extends AStepper {
    steps: TStepperSteps;

    constructor(steppers: AStepper[]) {
        super();
        this.steps = steppers.reduce((acc, stepper) => ({ ...acc, ...stepper.steps }), {});
    }
}

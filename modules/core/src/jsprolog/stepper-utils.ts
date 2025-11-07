import { AStepper, TStepperSteps } from '../lib/astepper.js';

export class CombinedStepper extends AStepper {
    steps: TStepperSteps = {};
    steppers: AStepper[];

    constructor(steppers: AStepper[]) {
        super();
        this.steppers = steppers;
    }

    init() {
        this.steps = this.steppers.reduce((acc, stepper) => ({ ...acc, ...stepper.steps }), {});
    }
}

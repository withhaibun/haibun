import { IStepper, IStepperConstructor, notOk, TShared } from "../lib/defs";

const Conformance: IStepperConstructor = class Conformance implements IStepper {
    steps = {
        must: {
            match: /(?!\n|. )\b([A-Z].*? must .*?\.)/,
            action: async (input: any) => notOk
        }
    }
}

export default Conformance;
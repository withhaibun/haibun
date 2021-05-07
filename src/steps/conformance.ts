import { IStepper, IStepperConstructor, notOk, TShared } from "../lib/defs";

const Conformance: IStepperConstructor = class Conformance implements IStepper {
    async close() {
    }
    steps = {
        must: {
            match: /(?!\n|. )\b([A-Z].*? must .*?\.)/g,
            action: async (input: any) => notOk
        }
    }
}

export default Conformance;
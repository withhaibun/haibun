import { TResult, TNotOkStepActionResult, TOutput } from '../lib/defs';
declare type TFailResult = {
    '@message': string;
    '@type': string;
    type?: string;
};
export default class AsXUnit implements TOutput {
    getOutput(result: TResult, { name, prettyPrint, classname }: {
        name?: string | undefined;
        prettyPrint?: boolean | undefined;
        classname?: string | undefined;
    }): Promise<string | undefined>;
    getFailResult(failure: TNotOkStepActionResult): TFailResult;
}
export {};
//# sourceMappingURL=AsXUnit.d.ts.map
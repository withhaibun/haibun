import { IStepper, TVStep, TResolvedFeature, TResult, TStepResult, TLogger, TFeatureResult, TWorld } from './defs';
export declare class Executor {
    steppers: IStepper[];
    world: TWorld;
    constructor(steppers: IStepper[], world: TWorld);
    execute(features: TResolvedFeature[]): Promise<TResult>;
    doFeature(feature: TResolvedFeature): Promise<TFeatureResult>;
    static doFeatureStep(vstep: TVStep, logger: TLogger): Promise<TStepResult>;
    close(): Promise<void>;
}
//# sourceMappingURL=Executor.d.ts.map
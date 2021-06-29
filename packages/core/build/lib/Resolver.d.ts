import { IStepper, TFeature, TFound, TResolvedFeature, TWorld } from './defs';
export declare class Resolver {
    steppers: IStepper[];
    world: TWorld;
    mode: string;
    constructor(steppers: IStepper[], mode: string, world: TWorld);
    resolveSteps(features: TFeature[]): Promise<TResolvedFeature[]>;
    addSteps(feature: TFeature): Promise<TResolvedFeature>;
    findSteps(actionable: string): TFound[];
}
//# sourceMappingURL=Resolver.d.ts.map
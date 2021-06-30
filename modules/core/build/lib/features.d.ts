import { TFeature, TFeatures } from './defs';
export declare function getSteps(value: string): string[];
export declare function expandBackgrounds(features: TFeatures, before?: string): Promise<TFeatures>;
export declare function findUpper(path: string, features: TFeatures): {
    rem: string;
    upper: TFeature[];
};
export declare function expandFeatures(features: TFeature[], backgrounds: TFeatures): Promise<TFeature[]>;
export declare function findFeature(name: string, features: TFeatures): TFeatures;
//# sourceMappingURL=features.d.ts.map
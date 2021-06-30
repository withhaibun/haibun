import { IStepper, IExtensionConstructor, IHasOptions, TFeature, TNotOKActionResult, TOKActionResult, TOptionValue, TResult, TShared, TSpecl, TWorld, TOptions, TProtoOptions } from './defs';
export declare function use(module: string): Promise<any>;
export declare function resultOutput(type: string | undefined, result: TResult, shared: TShared): Promise<any>;
export declare function actionNotOK(message: string, details?: any): TNotOKActionResult;
export declare function actionOK(details?: any): TOKActionResult;
export declare function getSteppers({ steppers, world, addSteppers }: {
    steppers: string[];
    world: TWorld;
    addSteppers?: IExtensionConstructor[];
}): Promise<IStepper[]>;
declare type TFilters = (string | RegExp)[];
export declare function recurse(dir: string, filters: TFilters): Promise<TFeature[]>;
export declare function getNamedMatches(regexp: RegExp, what: string): {
    [key: string]: string;
} | undefined;
export declare function getDefaultOptions(): TSpecl;
export declare function getOptionsOrDefault(base: string): TSpecl;
export declare function getActionable(value: string): string;
export declare function describeSteppers(steppers: IStepper[]): string;
export declare function isLowerCase(str: string): boolean | "";
export declare const sleep: (ms: number) => Promise<unknown>;
export declare function getDefaultWorld(): {
    world: TWorld;
};
export declare function processEnv(env: {
    [name: string]: string | undefined;
}, options: TOptions): {
    splits: TShared[];
    protoOptions: TProtoOptions;
};
export declare function applyExtraOptions(protoOptions: TProtoOptions, steppers: IStepper[], world: TWorld): void;
export declare function getStepperOptions(key: string, value: string, steppers: (IStepper & IHasOptions)[]): TOptionValue | void;
export declare function getStepperOption(stepper: IStepper, name: string, options: TOptions): TOptionValue;
export {};
//# sourceMappingURL=util.d.ts.map
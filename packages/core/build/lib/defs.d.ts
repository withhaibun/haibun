export declare type TLogLevel = 'none' | 'debug' | 'log' | 'info' | 'warn' | 'error';
export declare type TSpecl = {
    steppers: string[];
    mode: 'all' | 'some';
    refs?: {
        docs: {
            [name: string]: {
                src: string;
            };
        };
    };
    options: TOptions;
};
export declare type TOptions = {
    [name: string]: TOptionValue;
};
export declare type TOptionValue = string | boolean | number;
export interface IHasOptions {
    options?: {
        [name: string]: {
            desc: string;
            parse: (input: string) => TOptionValue;
        };
    };
}
export declare type TProtoOptions = {
    options: TOptions;
    extraOptions: {
        [name: string]: string;
    };
};
export declare type TWorld = {
    shared: TShared;
    runtime: TRuntime;
    logger: TLogger;
    options: TOptions;
};
export declare type TFeature = {
    path: string;
    feature: string;
};
export declare type TFeatures = TFeature[];
export declare type TResolvedFeature = {
    path: string;
    feature: string;
    vsteps: TVStep[];
};
export declare type TAction = (arg: any, vstep: TVStep) => Promise<TActionResult>;
export declare type TStep = {
    match?: RegExp;
    gwta?: string;
    exact?: string;
    action: TAction;
};
export interface IExtension {
    world?: TWorld;
    close?(): void;
}
export interface IStepper extends IExtension {
    steps: {
        [name: string]: TStep;
    };
}
export interface IExtensionConstructor {
    new (world: TWorld): IStepper;
}
export interface TLogger {
    debug: (what: any) => void;
    log: (what: any) => void;
    info: (what: any) => void;
    warn: (what: any) => void;
    error: (what: any) => void;
}
export declare type TShared = {
    [name: string]: string;
};
export declare type TVStep = {
    in: string;
    seq: number;
    actions: TFound[];
};
export declare type TFound = {
    name: string;
    step: TStep;
    named?: TNamed | undefined;
};
export declare type TNamed = {
    [name: string]: string;
};
export declare const OK: TOKActionResult;
export declare type TResultError = {
    context: any;
    details?: any;
};
export declare type TResult = {
    ok: boolean;
    results?: TFeatureResult[];
    failure?: {
        stage: 'Parse' | 'Options' | 'Expand' | 'Resolve' | 'Execute';
        error: TResultError;
    };
};
export declare type TOKActionResult = {
    ok: true;
    details?: any;
};
export declare type TNotOKActionResult = {
    ok: false;
    message: string;
    details?: any;
};
export declare type TActionResult = TOKActionResult | TNotOKActionResult;
export declare type TStepActionResult = TNotOkStepActionResult | TOKStepActionResult;
declare type TNamedStepActionResult = {
    name: string;
};
export declare type TNotOkStepActionResult = TNotOKActionResult & TNamedStepActionResult;
export declare type TOKStepActionResult = TOKActionResult & TNamedStepActionResult;
export declare type TFeatureResult = {
    skip?: boolean;
    comments?: string;
    path: string;
    ok: boolean;
    stepResults: TStepResult[];
    failure?: TFeatureResultFailure;
};
export declare type TFeatureResultFailure = {
    message: string;
    error: any;
    expected?: any;
};
export declare type TStepResult = {
    ok: boolean;
    actionResults: TStepActionResult[];
    in: string;
    seq: number;
};
export declare type TRuntime = {
    [name: string]: any;
};
export interface TOutput {
    getOutput(result: TResult, args: any): Promise<any>;
}
export declare type TKeyString = {
    [name: string]: string;
};
export declare const HAIBUN = "HAIBUN";
export {};
//# sourceMappingURL=defs.d.ts.map
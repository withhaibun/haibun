export type TLogLevel = 'none' | 'debug' | 'log' | 'info' | 'warn' | 'error';

export type TSpecl = {
  steppers: string[];
  mode: 'all' | 'some';
  refs?: {
    docs: { [name: string]: { src: string } };
  };
  options: TOptions;
};

export type TOptions = {
  [name: string]: TOptionValue;
};

export type TOptionValue = string | boolean | number;

export interface IHasOptions {
  options?: {
    [name: string]: {
      desc: string;
      parse: (input: string) => TOptionValue;
    };
  };
}

export interface IHasDomains {
  domains?: TDomain[];
}

export type TProtoOptions = {
  options: TOptions;
  extraOptions: { [name: string]: string };
};

interface TFromDomain {
  name: string;
  from: string;
  is: string;
}

export interface TFileTypeDomain {
  name: string;
  fileType: string;
  is: string;
}
// FIXME use | types
export type TDomain = TFromDomain | TFileTypeDomain;
export type TModuleDomain = TDomain &  { 
  backgrounds: TFeatures; 
  module: string 
};


export type TWorld = {
  shared: TShared;
  runtime: TRuntime;
  logger: TLogger;
  options: TOptions;
  domains: TModuleDomain[];
};

// FIXME make generic (content)
export type TFeature = {
  path: string;
  feature: string;
};

export type TFeatures = TFeature[];

export type TResolvedFeature = {
  path: string;
  feature: string;
  vsteps: TVStep[];
};

export type TAction = (arg: any, vstep: TVStep) => Promise<TActionResult>;
export type TRequiresResult = { includes?: string[] };

export type TStep = {
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
  steps: { [name: string]: TStep };
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

export type TShared = {
  [name: string]: string;
};

export type TVStep = {
  in: string;
  seq: number;
  actions: TFound[];
};
export type TFound = { name: string; step: TStep; named?: TNamed | undefined; vars?: TNamedVar[] };
export type TNamed = { [name: string]: string };
export type TNamedVar = { name: string; type: string };

export const OK: TOKActionResult = { ok: true };

export type TResultError = {
  context: any;
  details?: any;
};

export type TResult = {
  ok: boolean;
  results?: TFeatureResult[];
  failure?: {
    stage: 'Options' | 'Expand' | 'Resolve' | 'Execute';
    error: TResultError;
  };
};

export type TOKActionResult = {
  ok: true;
  details?: any;
};

export type TNotOKActionResult = {
  ok: false;
  message: string;
  details?: any;
};

export type TActionResult = TOKActionResult | TNotOKActionResult;

export type TStepActionResult = TNotOkStepActionResult | TOKStepActionResult;

type TNamedStepActionResult = {
  name: string;
};

export type TNotOkStepActionResult = TNotOKActionResult & TNamedStepActionResult;

export type TOKStepActionResult = TOKActionResult & TNamedStepActionResult;

export type TFeatureResult = {
  skip?: boolean;
  comments?: string;
  path: string;
  ok: boolean;
  stepResults: TStepResult[];
  failure?: TFeatureResultFailure;
};

export type TFeatureResultFailure = {
  message: string;
  error: any;
  expected?: any;
};

export type TStepResult = {
  ok: boolean;
  actionResults: TStepActionResult[];
  in: string;
  seq: number;
};

export type TRuntime = { [name: string]: any };

export interface TOutput {
  getOutput(result: TResult, args: any): Promise<any>;
}

export type TKeyString = { [name: string]: string };

export const HAIBUN = 'HAIBUN';

export const BASE_DOMAINS = [{ name: 'string', resolve: (inp: string) => inp }];

export const BASE_TYPES = BASE_DOMAINS.map((b) => b.name);

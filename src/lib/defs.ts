export type TLogLevel = 'none' | 'debug' | 'log' | 'info' | 'warn' | 'error';

export type TSpecl = {
  steppers: string[];
  mode: 'all' | 'some';
  refs?: {
    docs: { [name: string]: { src: string } };
  };
};

export type TFeature = {
  path: string;
  feature: string;
};

export type TFeatures = TFeature[];

export type TResolvedFeature = {
  feature: string;
  vsteps: TVStep[];
};

export type TAction = (arg: any) => Promise<{ ok: true | false }>;
export type TStep = {
  match?: RegExp;
  exact?: string;
  action: TAction;
};

export interface IStepper {
  shared?: TShared;
  steps: { [name: string]: TStep };
  close?(): void;
}

export interface IStepperConstructor {
  new (shared: TShared, runtime: TRuntime, logger: TLogger): IStepper;
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
export type TFound = { name: string; step: TStep; named?: TNamed };
export type TNamed = { [name: string]: string };

export const ok = { ok: true };
export const notOk = { ok: false };

export type TResultError = {
  context: any;
  details?: any;
};

export type TResult = {
  ok: boolean;
  results?: TStepResult[];
  failure?: {
    stage: 'Expand' | 'Resolve' | 'Investigate';
    error: TResultError;
  };
};

export type TActionResult = {
  ok: boolean;
  name: string;
};

export type TStepResult = {
  ok: boolean;
  actionResults: TActionResult[];
  in: string;
  seq: number;
};

export type TRuntime = { [name: string]: any };

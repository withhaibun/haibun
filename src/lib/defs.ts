export type TFeatures = { [name: string]: string };

export type TSpecl = {
  steppers: string[];
  mode: 'all' | 'some';
  refs?: {
    docs: { [name: string]: { src: string } };
  };
  features: TFeatures;
};

export type TFound = { name: string; step: TStep; named?: TNamed };
export type TNamed = { [name: string]: string };
export type TStep = {
  match?: RegExp;
  exact?: string;
  action: (arg: any) => Promise<{ ok: true | false; named?: TNamed }>;
};

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

export interface IStepper {
  steps: { [name: string]: TStep };
  close?(): void;
}

export interface IStepperConstructor {
  new (shared: TShared): IStepper;
}

export type TVStep = {
  in: string;
  seq: number;
  actions: TFound[];
};

export type TFeature = {
  feature: string;
};

export type TResolvedFeature = {
  vsteps: TVStep[];
};

export type TPaths = {
  [name: string]: TFeature | TPaths;
};

export type TShared = {
  [name: string]: string;
};
export type TOnFeature = (path: string, feature: string) => any;
export type TOnNode = (path: string, paths: TPaths) => any;

export type TMappedStep = {};

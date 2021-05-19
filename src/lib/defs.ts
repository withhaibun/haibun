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
  match: RegExp | string;
  action: (arg: any) => Promise<{ ok: true | false; named?: TNamed;  }>;
};

export const ok = { ok: true };
export const notOk = { ok: false };

export type TResult = {
  ok: boolean;
  results?: any;
  failure?: {
    stage: 'Resolver' | 'Investigator';
    error: Error;
  };
};

export type TStepResult = {
  ok: boolean;
  stepResults: TResult[]
}

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

export type TResolvedPaths = {
  [name: string]: TResolvedFeature | TResolvedPaths;
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

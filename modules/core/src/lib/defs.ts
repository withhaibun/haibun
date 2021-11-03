import { DomainContext, WorkspaceContext, WorldContext } from './contexts';
import { ILogger } from './interfaces/logger';

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

export type TOptionValue = any;

export interface IHasOptions {
  options?: {
    [name: string]: {
      desc: string;
      parse: (input: string) => TOptionValue;
    };
  };
}

export interface IHasDomains {
  domains: TDomain[];
  locator: (name: string) => string;
}
export interface IRequireDomains {
  requireDomains?: string[];
}

export type TProtoOptions = {
  options: TOptions;
  extraOptions: { [name: string]: string };
};

export type TFromDomain = {
  name: string;
  from: string;
  is: string;
};

export type TFileTypeDomain = {
  name: string;
  validate: (content: string) => undefined | string;
  fileType: string;
  is: string;
};
export type TDomain = TFromDomain | TFileTypeDomain;
export type TModuleDomain = TDomain & {
  module: IHasDomains;
  shared: DomainContext;
};

export type TWorld = {
  tag: TTag;
  shared: WorldContext;
  runtime: TRuntime;
  logger: ILogger;
  options: TOptions;
  domains: TModuleDomain[];
};

export type TFeatureMeta = {
  type: string;
  name: string;
  path: string;
};
export type TFeature = TFeatureMeta & {
  name: string;
  content: string;
};

export type TExpandedFeature = TFeatureMeta & {
  name: string;
  expanded: TExpandedLine[];
};

export type TExpandedLine = {
  line: string;
  feature: TFeature;
};

export type TFeatures = TFeature[];

export type TResolvedFeature = TExpandedFeature & {
  vsteps: TVStep[];
};


export type TTag = {
  sequence: number,
  loop: number,
  member: number,
  params?: any,
  traceDir?: string
}

export type TVStep = {
  // FIXME is this required?
  source: TFeature;
  in: string;
  seq: number;
  actions: TFound[];
};

export type TAction = (named: TNamed, vstep: TVStep) => Promise<TActionResult>;
export type TBuildResult = (TOKActionResult & { finalize?: TFinalize }) | TNotOKActionResult;
export type TBuild = (named: TNamed, vstep: TVStep, workspace: WorkspaceContext) => Promise<TBuildResult>;

export type TRequiresResult = { includes?: string[] };

export type TFinalize = (workspace: WorkspaceContext) => void;

export abstract class WorkspaceBuilder {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  addControl(...args: any) {}
  finalize(): any {}
}

export type TStep = {
  match?: RegExp;
  gwta?: string;
  exact?: string;
  action: TAction;
  build?: TBuild;
};

export interface IExtension {
  world?: TWorld;
  close?(): void;
  nextFeature?(): void;
}

export interface IStepper extends IExtension {
  steps: { [name: string]: TStep };
}

export interface IExtensionConstructor {
  new (world: TWorld): IStepper;
}
export type TFound = { name: string; step: TStep; named?: TNamed | undefined; vars?: TNamedVar[] };
export type TNamed = { [name: string]: string };
export type TNamedVar = { name: string; type: string };

export const OK: TOKActionResult = { ok: true };

export type TResultError = {
  details: { [name: string]: any };
  message: string;
};

export type TResult = {
  ok: boolean;
  results?: TFeatureResult[];
  failure?: {
    stage: 'Options' | 'Domains' | 'Expand' | 'Resolve' | 'Build' | 'Execute';
    error: TResultError;
  };
};

export type TOKActionResult = {
  ok: true;
  topics?: TActionResultTopics;
};

export type TActionResultTopics = { [topic: string]: { summary: string; details?: any } };

export type TNotOKActionResult = {
  ok: false;
  score?: number;
  message: string;
  topics?: TActionResultTopics;
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

export const HAIBUN = 'HAIBUN';

export const BASE_DOMAINS = [{ name: 'string', resolve: (inp: string) => inp }];

export const BASE_TYPES = BASE_DOMAINS.map((b) => b.name);

export type TScored = { name: string; score: number };

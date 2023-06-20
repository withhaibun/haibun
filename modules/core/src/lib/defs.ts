import { Resolver } from '../phases/Resolver.js';
import { DomainContext, WorkspaceContext, WorldContext } from './contexts.js';
import { ILogger } from './interfaces/logger.js';
import { Timer } from './Timer.js';

export type TSpecl = {
  steppers: string[];
  mode: 'all' | 'some';
  refs?: {
    docs: { [name: string]: { src: string } };
  };
  options: TOptions;
};

type TBaseOptions = {
  DEST: string;
};

export type TOptions = TBaseOptions & {
  [name: string]: TOptionValue;
};

export type TOptionValue = any;

export interface IHasOptions {
  options?: {
    [name: string]: {
      required?: boolean;
      default?: string;
      desc: string;
      parse: (input: string, existing?: TOptionValue) => { error?: string; env?: TOptions; result?: any };
    };
  };
}

export interface IHasBuilder {
  finalize: (workspace: WorkspaceContext) => void;
}
export interface IHasDomains {
  domains: TDomain[];
  locator: (name: string) => string;
}
export interface IRequireDomains {
  requireDomains?: string[];
}
export type TExtraOptions = { [name: string]: string };
export type TProtoOptions = {
  options: TOptions;
  extraOptions: TExtraOptions;
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


export type TBase = string[];

export type TWorld = {
  tag: TTag;
  shared: WorldContext;
  runtime: TRuntime;
  logger: ILogger;
  options: TOptions;
  extraOptions: TExtraOptions;
  domains: TModuleDomain[];
  timer: Timer;
  bases: TBase;
};

export type TFeatureMeta = {
  type: string;
  base: string;
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

export type TTagValue = number;
export type TTag = {
  when: number,
  sequence: number;
  featureNum: number;
  loop: number;
  member: number;
  params: any;
  trace: boolean;
};

export type TVStep = {
  source: TFeature;
  in: string;
  seq: number;
  actions: TFound[];
};

export type TAction = (named: TNamed, vstep: TVStep) => Promise<TActionResult>;
export type TBuildResult = (TOKActionResult & { finalize?: TFinalize, workspace?: WorkspaceContext }) | TNotOKActionResult;
export type TBuild = (named: TNamed, vstep: TVStep, workspace: WorkspaceContext, resolver: Resolver, steppers: AStepper[]) => Promise<TBuildResult>;

export type TRequiresResult = { includes?: string[] };

export type TFinalize = (workspace: WorkspaceContext) => void;

export abstract class WorkspaceBuilder {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  abstract addControl(...args: any);
  abstract finalize(): any;
}

export type TStep = {
  match?: RegExp;
  gwta?: string;
  exact?: string;
  action: TAction;
  build?: TBuild;
};

export interface CStepper {
  new(): AStepper;
  prototype: {
    steps: {
      [name: string]: TStep;
    };
    setWorld(world: TWorld, steppers: AStepper[]): void;
    getWorld(): TWorld;
  };
}

export abstract class AStepper {
  world?: TWorld;
  close?(): void;
  endFeature?(): void;
  onFailure?(result: TStepResult): void;
  setWorld(world: TWorld, steppers: AStepper[]) {
    this.world = world;
  }
  abstract steps: { [name: string]: TStep };
  getWorld() {
    if (!this.world) {
      throw Error(`stepper without world ${this.constructor.name}`);
    }

    return this.world;
  }
}

export type TFound = { actionName: string; stepperName: string; step: TStep; named?: TNamed | undefined; vars?: TNamedVar[] };
export type TNamed = { [name: string]: string };
export type TNamedVar = { name: string; type: string };

export const OK: TOKActionResult = { ok: true };

export type TExecutorResultError = {
  details: {
    [name: string]: any;
    stack: string[];
  };
  message: string;
};

export type TExecutorResult = {
  ok: boolean;
  tag: TTag;
  shared: WorldContext;
  topics?: TActionResultTopics;
  featureResults?: TFeatureResult[];
  failure?: {
    stage: string;
    error: TExecutorResultError;
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
  error?: Error,
  topics?: TActionResultTopics;
};

export type TTrace = {
  [name: string]: {
    url: string;
    since: number;
    trace: any;
  };
};

export type TTraces = {
  start?: number;
  // FIXME following should not be optional
  end?: number;
  traces?: TTrace[];
};

export type TTraceOptions = {
  [event: string]: {
    listener: any;
  };
};

export type TActionResult = TOKActionResult | TNotOKActionResult;

export type TStepActionResult = (TNotOkStepActionResult | TOKStepActionResult) & TTraces;

type TNamedStepActionResult = {
  name: string;
};

export type TNotOkStepActionResult = TNotOKActionResult & TNamedStepActionResult;

export type TOKStepActionResult = TOKActionResult & TNamedStepActionResult;

export type TFeatureResult = {
  skip?: boolean;
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
  sourcePath: string;
  seq: number;
};

export type TRuntime = { [name: string]: any };

export interface IResultOutput {
  writeOutput(result: TExecutorResult, args: any): Promise<any>;
}

export const HAIBUN = 'HAIBUN';
export const BASE_PREFIX = `${HAIBUN}_`;
export const CAPTURE = 'capture';
export const DEFAULT_DEST = 'default';

export const BASE_DOMAINS = [{ name: 'string', resolve: (inp: string) => inp }];

export const BASE_TYPES = BASE_DOMAINS.map((b) => b.name);

export type TScored = { name: string; score: number };

export type TStartRunCallback = (world: TWorld) => void;

export type TEndFeatureCallbackParams = { world: TWorld; result: TFeatureResult; steppers: AStepper[]; startOffset: number };
export type TEndFeatureCallback = (params: TEndFeatureCallbackParams) => Promise<void>;

export type TRunEnv = { [name: string]: string };
// FIXME remove protoOptions, splits, etc.
export type TRunOptions = {
  loops: number;
  members: number;
  trace: boolean;
  startRunCallback?: TStartRunCallback;
  endFeatureCallback?: TEndFeatureCallback;
  featureFilter?: string[];
  specl: TSpecl;
  bases: TBase;
  splits: TRunEnv[];
  protoOptions: TProtoOptions;
};
export type TRunResult = { output: any; result: TExecutorResult; shared: WorldContext; tag: TTag; runStart: number; runDuration: number; fromStart: number };

export const STAY_ALWAYS = 'always';
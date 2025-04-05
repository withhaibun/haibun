import { TTag, TStepResult, TFeatureStep } from '../defs.ts';
import { TArtifactRequestStepTopic, TArtifactSummaryTopic, TArtifactFailureStepTopic, TArtifactDebugTopic, TArtifact } from './artifacts.ts';

export type TMessageContext = TArtifactMessageContext | TExecutorResultMessageContext | TBasicMessageContext;
export type TMessageContextTopic = TArtifactRequestStepTopic | TArtifactSummaryTopic | TArtifactFailureStepTopic | TArtifactDebugTopic;

export type TArtifactMessageContext = {
	topic: TMessageContextTopic;
	artifact: TArtifact;
	tag?: TTag;
};
export type TBasicMessageContext = {
	tag: TTag;
};

export type TExecutorResultMessageContext = {
	topic: TExecutorResultTopic;
	tag: TTag;
};

export type TExecutorResultTopic = {
	result: TStepResult;
	step: TFeatureStep;
	stage: 'Executor';
};

export type TExecutorStepResult = {
	result: TStepResult;
	step: TFeatureStep;
	stage: 'Executor';
};

export type TScenarioTopic = {
	stage: 'Scenario';
	step: TFeatureStep;
	result: TStepResult;
}

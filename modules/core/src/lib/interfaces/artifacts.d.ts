import { TAnyFixme, TFeatureStep } from '../defs.ts';
import { TActionStage } from './logger.ts';

export type TArtifact = { artifactType: string } & TArtifactVideo | TArtifactVideoStart | TArtifactImage | TArtifactHTML | TArtifactJSON | TArtifactHTTPTrace;

type TBaseArtifactTopic = {
	stage: TActionStage;
};

export type TArtifactSummaryTopic = TBaseArtifactTopic & {
	event: 'summary';
};

export type TArtifactRequestStepTopic = TBaseArtifactTopic & {
	event: 'request';
	seq: number;
};

export type TArtifactDebugTopic = TBaseArtifactTopic & {
	event: 'debug';
};

export type TArtifactFailureStepTopic = TBaseArtifactTopic & {
	event: 'failure';
	step: TFeatureStep;
};

export type TTraceTopic = {
	type?: string;
	trace?: object;
};

export type TArtifactVideo = {
	artifactType: 'video';
	path: string;
};
// FIXME goofy
export type TArtifactVideoStart = {
	artifactType: 'video/start';
	start: number;
};
export type TArtifactImage = {
	artifactType: 'image';
	path: string;
};
export type TArtifactHTML = {
	artifactType: 'html';
	html: string;
};
export type TArtifactJSON = {
	artifactType: 'json';
	json: object;
};
export type TArtifactHTTPTrace = {
	artifactType: 'json/http/trace';
	trace: THTTPTraceContent;
};


export type TArtifactType = TArtifact['artifactType'];

export type THTTPTraceContent = {
	frameURL?: string;
	requestingPage?: string;
	requestingURL?: string;
	method?: string;
	headers?: Record<string, string>;
	postData?: TAnyFixme;
	status?: number;
	statusText?: string;
}

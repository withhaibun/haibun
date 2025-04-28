import { TAnyFixme, } from '../defs.js';

export type TArtifact = (
    TArtifactSpeech |
    TArtifactVideo |
    TArtifactVideoStart |
    TArtifactImage |
    TArtifactHTML |
    TArtifactJSON |
    TArtifactHTTPTrace
);

export type TArtifactSpeech = {
	artifactType: 'speech';
	transcript: string;
	path: string;
	runtimePath: string;
};

export type TArtifactVideo = {
	artifactType: 'video';
	path: string;
	runtimePath: string;
};

export type TArtifactVideoStart = {
	artifactType: 'video/start';
	start: number;
};
export type TArtifactImage = {
	artifactType: 'image';
	path: string;
	runtimePath: string;
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
	httpEvent: 'response' | 'request' | 'route';
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

import { TAnyFixme, TTag } from '../defs.js';
import { TArtifact } from './artifacts.js';
import { EExecutionMessageType } from './logger.js';

export type TMessageContext = {
	incident: EExecutionMessageType;
	artifact?: TArtifact;
	incidentDetails?: TAnyFixme;
	tag?: TTag;
};

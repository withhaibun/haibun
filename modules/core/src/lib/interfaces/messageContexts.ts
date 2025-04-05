import { TTag, TAnyFixme } from '../defs.js';
import { TArtifact } from './artifacts.js';
import { EExecutionMessageType } from './logger.js';

export type TMessageContext = {
  incident: EExecutionMessageType;
  artifact?: TArtifact;
  tag: TTag;
  incidentDetails?: TAnyFixme;
};

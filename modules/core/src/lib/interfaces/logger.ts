import { TActionResultTopics } from '../defs';

export type TLogLevel = 'none' | 'debug' | 'log' | 'info' | 'warn' | 'error';

export type TExecutorTopic = {
  topics: TActionResultTopics;
  seq: number;
  stage: 'Executor';
};
// currently there is just the Executor instance
export type TMessageTopic = TExecutorTopic;

export interface TLogger {
  debug: (what: any, topic?: TMessageTopic) => void;
  log: (what: any, topic?: TMessageTopic) => void;
  info: (what: any, topic?: TMessageTopic) => void;
  warn: (what: any, topic?: TMessageTopic) => void;
  error: (what: any, topic?: TMessageTopic) => void;
  addSubscriber: (subscriber: ISubscriber) => void;
}
export interface ISubscriber {
  out: (level: TLogLevel, args: any[], topic?: TMessageTopic) => void;
}

export type TMessage = { level: string; message: string; messageTopic?: TMessageTopic };
export type TMessageWithTopic = { level: string; message: string; messageTopic: TMessageTopic };

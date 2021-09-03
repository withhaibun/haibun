export type TLogLevel = 'none' | 'debug' | 'log' | 'info' | 'warn' | 'error';

export interface TLogger {
  debug: (what: any) => void;
  log: (what: any) => void;
  info: (what: any) => void;
  warn: (what: any) => void;
  error: (what: any) => void;
  addSubscriber: (subsctriber: ISubscriber) => void;
}
export interface ISubscriber {
  out: (level: TLogLevel, args: any[]) => void;
}

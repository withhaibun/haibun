import { versionedSchema } from '@haibun/core/build/lib/defs.js';
import { TLogHistory, TLogHistoryWithArtifact, TLogHistoryWithExecutorTopic } from '@haibun/core/build/lib/interfaces/logger.js';

export const SCHEMA_HISTORY_WITH_META = versionedSchema('HistoryWithMeta');
export const SCHEMA_FOUND_HISTORIES = versionedSchema('FoundHistories');

// these are bundled tracks files
export type TFoundHistories = {
  '$schema': typeof SCHEMA_FOUND_HISTORIES
  meta: {
    date: number;
    ok: number;
    fail: number;
  };
  histories: TNamedHistories;
};
export type TNamedHistories = { [name: string]: THistoryWithMeta; };
// these are saved tracks files
export type THistoryWithMeta = {
  '$schema': typeof SCHEMA_HISTORY_WITH_META;
  meta: {
    startTime: string;
    description: string;
    feature: string,
    startOffset: number;
    ok: boolean;
  };
  logHistory: TLogHistory[];
};

export function findArtifacts(historyWithMeta?: THistoryWithMeta): TLogHistoryWithArtifact[] {
  return <TLogHistoryWithArtifact[]>historyWithMeta?.logHistory.filter(h => asArtifact(h));
}

export const findActionResults = (logHistory?: TLogHistory[]) => logHistory.filter(h => !!asActionResult(h));

export function asActionResult(logHistory: TLogHistory | undefined): TLogHistoryWithExecutorTopic | undefined {
  if (logHistory === undefined) { return undefined; }
  const topic = (<TLogHistoryWithExecutorTopic>logHistory).messageContext.topic;
  return topic?.stage === 'Executor' && topic?.result ? <TLogHistoryWithExecutorTopic>logHistory : undefined;
}

export function asArtifact(logHistory: TLogHistory | undefined): TLogHistoryWithArtifact | undefined {
  return logHistory !== undefined && (<TLogHistoryWithArtifact>logHistory)?.messageContext?.artifact ? <TLogHistoryWithArtifact>logHistory : undefined;
}

export function asStepperActionType(logHistory: TLogHistory | undefined, stepperType: string): TLogHistoryWithExecutorTopic | undefined {
  const ret = (actionName(logHistory) === stepperType) ? <TLogHistoryWithExecutorTopic>logHistory : undefined;
  return ret;
}

export const actionName = (logHistory: TLogHistory | undefined) => {
  return (<TLogHistoryWithExecutorTopic>logHistory).messageContext?.topic?.step?.actions[0].actionName;
}
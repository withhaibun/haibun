import { TLogHistory, TLogHistoryWithArtifact, TLogHistoryWithExecutorTopic } from '@haibun/core/build/lib/interfaces/logger.js';

// these are bundled tracks files
export type TFoundHistories = {
  '$schema': 'FoundHistories/1.0',
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
  '$schema': 'THistoryWithMeta/1.0',
  meta: {
    startTime: string;
    title: string;
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

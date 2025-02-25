
import { versionedSchema } from './defs.js';
import { SCHEMA_HISTORY_WITH_META, THistoryWithMeta, TLogHistory, TLogHistoryWithArtifact, TLogHistoryWithExecutorTopic } from './interfaces/logger.js';

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
export function asHistoryWithMeta(logHistory: TLogHistory[], startTime: Date, description: string, startOffset: number, ok: boolean) {
    const logFeature = <TLogHistoryWithExecutorTopic>logHistory.find(h => asStepperActionType(h, 'feature'));
    const feature = logFeature?.messageContext?.tag?.params?.feature || 'missing feature' + (logFeature?.messageContext?.tag || logFeature);

    const history: THistoryWithMeta = {
        '$schema': SCHEMA_HISTORY_WITH_META,
        meta: { startTime: startTime.toISOString(), description, feature, startOffset, ok },
        logHistory
    };
    return history;
}

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
    return (<TLogHistoryWithExecutorTopic>logHistory).messageContext?.topic?.step?.action[0].actionName;
}

export const TRACKS_FILE = `tracksHistory.json`;
export const TRACKS_DIR = 'tracks';

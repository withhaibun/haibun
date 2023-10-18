import { TLogHistory } from '@haibun/core/build/lib/interfaces/logger.js';

export type TFoundHistories = {
  meta: {
    date: number;
    ok: number;
    fail: number;
  };
  histories: TNamedHistories;
};
export type TNamedHistories = { [name: string]: THistoryWithMeta; };

export type THistoryWithMeta = {
  meta: {
    startTime: string;
    title: string;
    startOffset: number;
    ok: boolean;
  };
  logHistory: TLogHistory[];
};

import { getLatestPublished, summarize } from './indexer.js';

export type TTraceHistorySummary = {
  link: string,
  date: string,
  titles: string[],
  results: {
    success: number,
    fail: number
  }
}

export type TPRData = {
  link: string,
  title: string,
  date: string,
};

export class DataAccess {
  private latest: string[] = [];

  async getLatest() {
    if (this.latest.length > 0) {
      return this.latest;
    }
    return await getLatestPublished();
  }

  async getTracksHistories(): Promise<TTraceHistorySummary[]> {
    const links = await this.getLatest();
    const historyFiles: string[] = links.filter(link => link.endsWith('-tracksHistory.json'));
    if (!historyFiles) {
      return [];
    }
    const foundHistories: TTraceHistorySummary[] = [];
    for (const source of historyFiles) {
      const summary = await summarize(source);
      foundHistories.push(summary);
    }
    return foundHistories;
  }
}


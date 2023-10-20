import { getPublishedReviews } from './indexer.js';
import { TFoundHistories } from "@haibun/out-review/build/lib.js";

const apiUrl = '/tracks';

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
    let endpoint = apiUrl;
    try {
      endpoint = (await (await fetch('indexer-endpoint.json')).json()).endpoint;
    } catch (e) {
      // default endpoint
    }
    return await getPublishedReviews(endpoint);
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


export async function summarize(file: string): Promise<TTraceHistorySummary> {
  const link = `${apiUrl}/${file}`;
  const response = await fetch(link);
  const foundHistory: TFoundHistories = await response.json();
  return {
    titles: Object.values(foundHistory.histories).map(h => h.meta.title),
    link: `reviews.html#source=${link}`,
    date: new Date(foundHistory.meta.date).toLocaleString(),
    results: {
      success: Object.values(foundHistory.histories).filter(h => !!h.meta.ok).length,
      fail: Object.values(foundHistory.histories).filter(h => !!h.meta.ok).length,
    }
  }
}
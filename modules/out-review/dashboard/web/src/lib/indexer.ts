// this module might be replaced by specific storage implementations at runtime

import { TFoundHistories } from "../../../../build/out-reviews-stepper.js";
import { TTraceHistorySummary } from "./data-access.js";

const apiUrl = '/tracks';

export async function getLatestPublished() {
  const response = await fetch(`${apiUrl}/`);
  const data = await response.text();
  const latest = parseLinks(data).map(link => link.replace(apiUrl, ''))
    .map(link => link.replace(/^\//, '')).filter(link => link.length > 0);
  return latest;
}

export function parseLinks(html: string): string[] {
  const links: string[] = [];
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/g;

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const link = match[2];
    links.push(link);
  }

  return links;
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

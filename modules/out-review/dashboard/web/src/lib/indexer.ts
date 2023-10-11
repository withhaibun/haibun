// this module might be replaced by specific storage implementations at runtime

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
export async function summarize(link: string): Promise<TTraceHistorySummary> {
  const response = await fetch(`${apiUrl}/${link}`);
  const foundHistory = await response.json();
  return {
    link: link.replace(/.*\//, ''),
    date: new Date(foundHistory.meta.date).toLocaleString(),
    results: {
      success: 1,
      fail: 0
    }
  }
}

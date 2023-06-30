export type TPRData = { link: string; title: string, date: string }
import { TReviewLink } from '@haibun/out-review';

export class DataAccess {
  private latest: string[] = [];
  private apiUrl = '/reviews';

  async getLatest() {
    if (this.latest.length > 0) {
      return this.latest;
    }
    const response = await fetch(`${this.apiUrl}/`);
    const data = await response.text();
    this.latest = parseLinks(data).map(link => link.replace(this.apiUrl, ''))
      .map(link => link.replace(/^\//, '')).filter(link => link.length > 0);
    return this.latest;
  }

  async getJSON(loc: string) {
    const response = await fetch(`${this.apiUrl}/${loc}`);
    const data = await response.json();
    return data;
  }

  async getLatestPR(): Promise<TPRData | null> {
    const links = await this.getLatest();

    const prLink = links.find(link => link === 'deployed-pr.json');
    if (!prLink) {
      return null;
    }
    return await this.getJSON(prLink);
  }

  async getReviewData(): Promise<TReviewLink[]> {
    const links = await this.getLatest();
    const reviews = links.filter(link => link.match(/.*-review\.json/));
    if (!reviews) {
      return [];
    }
    const foundReviews: TReviewLink[] = [];
    for (const review of reviews) {
      foundReviews.push(await this.getJSON(review));
    }
    return foundReviews;
  }
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

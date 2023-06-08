export type TPRData = { link: string; title: string, date: string }
export type TReview = { link: string; title: string; date: string; results: { fail: number; success: number; } }

export class DataAccess {
  private latest: string[] = [];
  private apiUrl = '/links';

  async getLatest() {
    if (this.latest.length > 0) {
      return this.latest;
    }
    const response = await fetch(`${this.apiUrl}/`);
    const data = await response.text();
    this.latest = parseLinks(data).map(link => link.replace('./', ''));
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

  async getReviewData(): Promise<TReview[]> {
    const links = await this.getLatest();
    const reviews = links.filter(link => link.match(/.*-review-\d+\.json/));
    if (!reviews) {
      return [];
    }
    let foundReviews: TReview[] = [];
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

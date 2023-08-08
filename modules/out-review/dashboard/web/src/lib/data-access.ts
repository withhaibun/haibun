export type TPRData = { link: string; title: string, date: string }
import { TReviewLink } from '@haibun/domain-storage/build/domain-storage.js';
import { getLatestPublished, resolvePublishedReview } from './indexer.js';

export class DataAccess {
  private latest: string[] = [];

  async getLatest() {
    if (this.latest.length > 0) {
      return this.latest;
    }
    return await getLatestPublished();
  }

  async getReviewData(): Promise<TReviewLink[]> {
    const links = await this.getLatest();
    const reviews = links.filter(link => link.match(/.*-reviews\.json/));
    if (!reviews) {
      return [];
    }
    const foundReviews: TReviewLink[] = [];
    for (const review of reviews) {
      const resolved = await resolvePublishedReview(review);
      foundReviews.push(resolved);
    }
    return foundReviews;
  }
  // Get the latest deployed pull request address
  async getLatestPR(): Promise<TPRData | null> {
    const links = await this.getLatest();

    const prLink = links.find(link => link === 'deployed-pr.json');
    if (!prLink) {
      return null;
    }
    return await resolvePublishedReview(prLink);
  }

}


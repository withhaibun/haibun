import { DataAccess, TPRData } from './lib/data-access.js';
import { TReviewLink } from '@haibun/out-review';

export class PrairieJsonExplorer extends HTMLElement {
  private dataAccess: DataAccess;

  constructor() {
    super();
    this.dataAccess = new DataAccess();
  }

  async connectedCallback() {
    const prData = await this.dataAccess.getLatestPR();
    const reviewData = await this.dataAccess.getReviewData();

    this.render(prData, reviewData);
  }

  render(prData: TPRData | null, reviewData: TReviewLink[]) {
    const prLink = prData ? `<a href="${prData.link}" data-testid="_hai-latest-pr">${prData.title} (${prData.date})</a>` : 'No latest PR found.';
    const reviewLinks = reviewData.length > 0 ? reviewData.map(review => `<a href="${review.link}" data-testid="_hai-review-${review.title}">${review.title} (${review.date}) ✅ ${review.results?.success} ❌ ${review.results?.fail}</a>`).join('<br>') : 'No review files found.';

    this.innerHTML = `
      <div class="list-container">
        <h2>Latest PR</h2>
        <div class="list-item">${prLink}</div>
        <h2>Reviews</h2>
        <div class="list-item">${reviewLinks}</div>
      </div>
    `;
  }
}

customElements.define('link-results', PrairieJsonExplorer);
import { DataAccess, TPRData, TTraceHistorySummary } from './lib/data-access.js';

export class ReviewOverview extends HTMLElement {
  private dataAccess: DataAccess;

  constructor() {
    super();
    this.dataAccess = new DataAccess();
  }

  async connectedCallback() {
    const prData = null; //await this.dataAccess.getLatestPR();
    const reviewData = await this.dataAccess.getTracksHistories();

    this.render(prData, reviewData);
  }

  render(prData: TPRData | null, reviewData: TTraceHistorySummary[]) {
    // const prLink = prData ? `<a href="${prData.link}" data-testid="_hai-latest-pr">${prData.title} (${prData.date})</a>` : 'No latest PR found.';
    const reviewLinks = reviewData.length > 0 ? reviewData.map(review => {
      const titles = review.titles;
      return `<a href="${review.link}" data-testid="_hai-review-titles">${titles} (${review.date}) ✅ ${review.results?.success} ❌ ${review.results?.fail}</a>`;
    }).join('<br>') : 'No review files found.';

    this.innerHTML = `
      <div class="list-container">
        <h2>Reviews</h2>
        <div class="list-item">${reviewLinks}</div>
      </div>
    `;
  }
}

customElements.define('link-results', ReviewOverview);

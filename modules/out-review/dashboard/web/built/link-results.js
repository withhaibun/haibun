var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { DataAccess } from './lib/data-access.js';
export class PrairieJsonExplorer extends HTMLElement {
    constructor() {
        super();
        this.dataAccess = new DataAccess();
    }
    connectedCallback() {
        return __awaiter(this, void 0, void 0, function* () {
            const prData = yield this.dataAccess.getLatestPR();
            const reviewData = yield this.dataAccess.getReviewData();
            this.render(prData, reviewData);
        });
    }
    render(prData, reviewData) {
        const prLink = prData ? `<a href="${prData.link}" data-testid="_hai-latest-pr">${prData.title} (${prData.date})</a>` : 'No latest PR found.';
        const reviewLinks = reviewData.length > 0 ? reviewData.map(review => `<a href="${review.link}" data-testid="_hai-review-${review.title}">${review.title} (${review.date}) ✅ ${review.results.success} ❌ ${review.results.fail}</a>`).join('<br>') : 'No review files found.';
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

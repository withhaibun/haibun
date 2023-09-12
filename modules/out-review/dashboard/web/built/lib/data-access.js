var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getLatestPublished, resolvePublishedReview } from './indexer.js';
export class DataAccess {
    constructor() {
        this.latest = [];
    }
    getLatest() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.latest.length > 0) {
                return this.latest;
            }
            return yield getLatestPublished();
        });
    }
    getReviewData() {
        return __awaiter(this, void 0, void 0, function* () {
            const links = yield this.getLatest();
            const reviews = links.filter(link => link.match(/.*-reviews\.json/));
            if (!reviews) {
                return [];
            }
            const foundReviews = [];
            for (const review of reviews) {
                const resolved = yield resolvePublishedReview(review);
                foundReviews.push(resolved);
            }
            return foundReviews;
        });
    }
    // Get the latest deployed pull request address
    getLatestPR() {
        return __awaiter(this, void 0, void 0, function* () {
            const links = yield this.getLatest();
            const prLink = links.find(link => link === 'deployed-pr.json');
            if (!prLink) {
                return null;
            }
            return yield resolvePublishedReview(prLink);
        });
    }
}

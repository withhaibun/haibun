var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class DataAccess {
    constructor() {
        this.latest = [];
        this.apiUrl = '/links';
    }
    getLatest() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.latest.length > 0) {
                return this.latest;
            }
            const response = yield fetch(`${this.apiUrl}/`);
            const data = yield response.text();
            this.latest = parseLinks(data).map(link => link.replace('./', ''));
            return this.latest;
        });
    }
    getJSON(loc) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield fetch(`${this.apiUrl}/${loc}`);
            const data = yield response.json();
            return data;
        });
    }
    getLatestPR() {
        return __awaiter(this, void 0, void 0, function* () {
            const links = yield this.getLatest();
            const prLink = links.find(link => link === 'deployed-pr.json');
            if (!prLink) {
                return null;
            }
            return yield this.getJSON(prLink);
        });
    }
    getReviewData() {
        return __awaiter(this, void 0, void 0, function* () {
            const links = yield this.getLatest();
            const reviews = links.filter(link => link.match(/.*-review-\d+\.json/));
            if (!reviews) {
                return [];
            }
            let foundReviews = [];
            for (const review of reviews) {
                foundReviews.push(yield this.getJSON(review));
            }
            return foundReviews;
        });
    }
}
export function parseLinks(html) {
    const links = [];
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/g;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        const link = match[2];
        links.push(link);
    }
    return links;
}

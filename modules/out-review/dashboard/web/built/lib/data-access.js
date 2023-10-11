var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getLatestPublished, summarize } from './indexer.js';
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
    getTracksHistories() {
        return __awaiter(this, void 0, void 0, function* () {
            const links = yield this.getLatest();
            const historyFiles = links.filter(link => link.endsWith('-tracksHistory.json'));
            if (!historyFiles) {
                return [];
            }
            const foundHistories = [];
            for (const source of historyFiles) {
                const summary = yield summarize(source);
                foundHistories.push(summary);
            }
            return foundHistories;
        });
    }
}

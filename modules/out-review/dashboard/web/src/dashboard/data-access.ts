import { TFoundHistories, TRACKS_FILE } from '@haibun/core/build/lib/LogHistory.js';
import { endpoint } from './indexer.js';

export type TTraceHistorySummary = {
	link: string;
	date: string;
	features: string[];
	results: {
		success: number;
		fail: number;
	};
};

export type TPRData = {
	link: string;
	title: string;
	date: string;
};

export class DataAccess {
	private latest: string[] = [];

	async getLatest(): Promise<string[]> {
		try {
			if (this.latest.length > 0) {
				return this.latest;
			}
			const indexer = await import('./indexer.js');
			return await indexer.getPublishedReviews();
		} catch (e) {
			console.error(e);
			throw Error(`Failed to get latest reviews: ${e.message}`);
		}
	}

	async getTracksHistories(): Promise<TTraceHistorySummary[]> {
		const historyFiles = await this.getLatest();
		if (!historyFiles) {
			return [];
		}
		const foundHistories: TTraceHistorySummary[] = [];
		for (const source of historyFiles) {
			if (!source.endsWith(TRACKS_FILE)) {
				return;
			}
			try {
				const summary = await summarize(source);
				foundHistories.push(summary);
			} catch (e) {
				console.error('summarize', source, e);
				throw Error(`Failed to summarize ${source}: ${e.message}. Check the console for a stack trace.`);
			}
		}
		return foundHistories;
	}
}

export async function summarize(file: string): Promise<TTraceHistorySummary> {
	const link = `${endpoint}${file}`;
	const response = await fetch(link);
	const foundHistory: TFoundHistories = await response.json();
	return {
		features: Object.values(foundHistory.histories).map((h) => h.meta.feature),
		link: `reviewer.html#source=${link}`,
		date: new Date(foundHistory.meta.date).toLocaleString(),
		results: {
			success: Object.values(foundHistory.histories).filter((h) => !!h.meta.ok).length,
			fail: Object.values(foundHistory.histories).filter((h) => !h.meta.ok).length,
		},
	};
}

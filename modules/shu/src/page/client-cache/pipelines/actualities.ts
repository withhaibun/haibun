/**
 * The actualities this device holds, and what it deletes to hold another.
 *
 * A record's id names its actuality feature, and an actuality feature names the actuality whose feature it ran, so the ids themselves
 * separate what a device holds of many actualities, rather than a second index beside them. The actualities are read from
 * records of its features, each of which names a feature of an actuality for a reader.
 */
import { ACTUALITY_FIELD, FEATURE_LEVEL, SEQ_PATH_FIELD, SeqPathSchema, actualityFeatureOf, actualityOf, parseRecordName } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { GraphQuerySchema, type TGraphQuery, type TQuad } from "@haibun/core/lib/quad-types.js";
import { equalTo } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { MAX_PAGE_ROWS } from "@haibun/core/lib/domains/hypermedia.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import type { TCachedGraph, TDeviceReport } from "../ports.js";
import { ACTUALITY_TYPES } from "../derivations/actuality-rows.js";

/** An actuality as this device holds it: its key, the graph of its records, the features it ran, the actuality feature of its
 *  newest feature, the moments its features span, and the actuality features its records state, its own first. */
export type THeldActuality = { actuality: string; store: TCachedGraph; features: string[]; newest: string; first: number; last: number; held: string[] };

/** How many records of features the listing reads: what names the actualities a reader is offered. */
export const FEATURES_READ = 500;

/** What holding an actuality reads and writes: the graphs of every actuality the device holds, the graph of the one the
 *  site serves, whether the page reads another graph the device holds, the actuality feature the page reads, and the report of
 *  what the device couldn't hold. */
export type THoldScope = { held: () => Promise<TCachedGraph[]>; served: () => TCachedGraph; readsHeld: () => boolean; reading: () => string | undefined; report: TDeviceReport };

/** The actualities of every graph, newest first, each named by the features it ran. */
export async function actualitiesHeld(graphs: TCachedGraph[]): Promise<THeldActuality[]> {
	const held = await Promise.all(graphs.map(actualitiesIn));
	return held.flat().sort((a, b) => b.first - a.first);
}

/** The actualities one graph holds, from the records of its features, newest first, up to `FEATURES_READ` of them. */
async function actualitiesIn(store: TCachedGraph): Promise<THeldActuality[]> {
	const read = { label: SEQ_PATH_LABEL, filters: equalTo({ [SEQ_PATH_FIELD.actualityLevel]: FEATURE_LEVEL }), sortBy: SEQ_PATH_FIELD.generatedAtTime, sortOrder: "desc" };
	const declared = (await store.readRecords(GraphQuerySchema.parse({ ...read, limit: FEATURES_READ, skipCount: true }))).vertices.map((record) => SeqPathSchema.parse(record));
	const byActuality = new Map<string, THeldActuality>();
	for (const step of declared) {
		const name = parseRecordName(step.id);
		if (name === undefined) throw new Error(`the record ${step.id} of a feature doesn't name the actuality feature it ran in`);
		const at = Date.parse(step[SEQ_PATH_FIELD.generatedAtTime]);
		if (Number.isNaN(at)) throw new Error(`the record ${step.id} states when its feature began as ${step[SEQ_PATH_FIELD.generatedAtTime]}, not an instant`);
		const feature = step[SEQ_PATH_FIELD.stepText];
		const actuality = actualityOf(name.actuality);
		const held = byActuality.get(actuality);
		// The newest feature comes first, so each later one is an earlier feature.
		if (held === undefined)
			byActuality.set(actuality, {
				actuality,
				store,
				features: [feature],
				newest: name.actuality,
				first: at,
				last: at,
				held: [actualityFeatureOf({ key: actuality, featureNum: 0 }), name.actuality],
			});
		else {
			if (!held.features.includes(feature)) held.features.unshift(feature);
			held.held.push(name.actuality);
			held.first = at;
		}
	}
	return [...byActuality.values()];
}

/** Deletes every record of one actuality this device holds: its own record and the records of every feature, scenario and
 *  step it ran, with what they logged and produced, a page of each type at a time by the actuality features it holds. Returns
 *  how many went. */
export async function deleteActuality({ held, store }: THeldActuality): Promise<number> {
	let gone = 0;
	for (const type of ACTUALITY_TYPES) {
		const page = GraphQuerySchema.parse({
			label: type.label,
			filters: [{ predicate: ACTUALITY_FIELD, operator: "in", value: itemAt(held, 0), values: held }],
			limit: MAX_PAGE_ROWS,
			skipCount: true,
		});
		for (let ids = await idsOf(store, page, type.label); ids.length > 0; ids = await idsOf(store, page, type.label)) {
			for (const id of ids) await store.remove({ label: type.label, id });
			gone += ids.length;
		}
	}
	return gone;
}

/** The ids of a page of the records of a read. */
const idsOf = async (store: TCachedGraph, read: TGraphQuery, label: string): Promise<string[]> => (await store.readRecords(read)).vertices.map((record) => recordId(record, label));

/** A record's id, which every record of an actuality states. */
function recordId(record: Record<string, unknown>, label: string): string {
	const id = record[SEQ_PATH_FIELD.id];
	if (typeof id !== "string") throw new Error(`a record of ${label} states its id as ${typeof id}, not a string`);
	return id;
}

/** Whether a write failed because the browser lacks room for what this page holds. */
const storageIsFull = (err: unknown): boolean => err instanceof DOMException && err.name === "QuotaExceededError";

/**
 * Holds what a window read on this device, in one write.
 *
 * What a device holds is the actualities a reader can come back to, and it holds them until the browser lacks room. At
 * that point the oldest actuality the reader isn't reading is deleted and the write is tried once more, so what is kept is
 * the actualities nearest to what a reader reads rather than whichever ones were written first. A device without an
 * actuality it can delete reports so: reading carries on against the site, and a reader who loses the site loses what
 * this write would have held. A window read from another graph the device holds is held in that graph already, so it isn't
 * written to the graph of the actuality the site serves, which holds that actuality's records alone.
 */
export async function holdOnDevice(scope: THoldScope, quads: TQuad[]): Promise<void> {
	if (quads.length === 0 || scope.readsHeld()) return;
	try {
		await scope.served().setMany(quads);
	} catch (err: unknown) {
		if (!storageIsFull(err)) return scope.report.failure("actuality's records could not be held on this device", err);
		const reading = scope.reading();
		const readingActuality = reading === undefined ? undefined : actualityOf(reading);
		const oldest = (await actualitiesHeld(await scope.held())).filter((one) => one.actuality !== readingActuality).pop();
		if (oldest === undefined) return scope.report.failure("this device is full, and it holds only the actuality being read", err);
		const gone = await deleteActuality(oldest);
		// Making room is what a full device does rather than a failure of the page, so it is reported rather than thrown:
		// a reader whose earlier actuality is gone reads why.
		scope.report.warn(`this device is full, so actuality ${oldest.actuality} and its ${gone} records were deleted`);
		await scope
			.served()
			.setMany(quads)
			.catch((again: unknown) => scope.report.failure("actuality's records could not be held on this device after deleting an actuality", again));
	}
}

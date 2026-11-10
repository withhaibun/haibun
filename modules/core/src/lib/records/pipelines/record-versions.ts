/**
 * Versions of records and the writes made from a read of them. A store returns a record's version beside it, a unit written
 * from that read states the version in an update, and the store refuses the update where the record's fields changed since. A writer that
 * reads a record, changes it and writes it back reads again and writes again on that refusal, so a change made between its
 * read and its write isn't lost, and the store doesn't hold a lock or a transaction across the writer's read.
 */
import type { z } from "zod";
import type { IQuadStore } from "../../steps/ports.js";
import type { TRecordType } from "../../steps/domains/quad-types.js";
import { LinkRelations } from "../../domains/resources.js";
import { assertReadVersion, ChangedSinceRead, NODE_KEY, type TNode, type TReadVersion, type TRecordName, type TVersionedRead } from "../domains/unit.js";

/** Reads the record `type` and `id` name with its version: the version first, then the record. A write between the two reads
 *  leaves the record newer than its version, so a unit written from it is refused and the caller reads again. */
export async function readVersioned<S extends z.ZodType>(
	store: Pick<IQuadStore, "versionOf" | "readRecord">,
	type: TRecordType<S>,
	id: string,
): Promise<TVersionedRead<z.output<S>>> {
	const version = await store.versionOf({ label: type.label, id });
	return { version, record: await store.readRecord(type, id) };
}

/** Runs `attempt`, which reads records with their versions and updates them from those versions, again where a store refuses
 *  one of its updates because the record changed since its read, up to `attempts` runs. Throws the last refusal, with the
 *  number of runs, where every run is refused. */
export async function rereadAndRetry<T>(attempts: number, attempt: () => Promise<T>): Promise<T> {
	for (let run = 1; ; run++) {
		try {
			return await attempt();
		} catch (error) {
			if (!(error instanceof ChangedSinceRead)) throw error;
			if (run >= attempts)
				throw new Error(
					`${error.message}. The write was refused ${attempts} times, each after a read of the record; another writer changes the record between each read and write`,
					{ cause: error },
				);
		}
	}
}

/** How many times a kept record is read again after another writer wrote it between the read and the write. A second read
 *  finds it held. */
const KEEP_ATTEMPTS = 2;

/** Writes `node` where the store doesn't hold its record, and keeps the held record where each field that both it and the node
 *  state holds the same value, apart from the record's provenance, which the store states. A read doesn't carry a record's bodies,
 *  so a body isn't compared. `read` reads the record with its version, and `update` writes the node at that version, so a record
 *  another writer writes between the two is read again. Returns the held record, or undefined where the node was written. Throws,
 *  naming each field, where the held record states another value of it. */
export async function createOrKeep<T extends Readonly<Record<string, unknown>>>(
	read: () => Promise<TVersionedRead<T>>,
	update: (node: TNode, version: TReadVersion) => Promise<string>,
	node: TNode,
): Promise<T | undefined> {
	return await rereadAndRetry(KEEP_ATTEMPTS, async () => {
		const { record, version } = await read();
		if (record === undefined) {
			await update(node, version);
			return undefined;
		}
		const differing = Object.entries(node).filter(
			([key, value]) =>
				key !== NODE_KEY.type &&
				key !== LinkRelations.GENERATED_AT_TIME.rel &&
				value !== undefined &&
				record[key] !== undefined &&
				JSON.stringify(value) !== JSON.stringify(record[key]),
		);
		if (differing.length > 0)
			throw new Error(
				`the store holds the ${node[NODE_KEY.type]} record this write names, and it states ${differing.map(([key]) => `${key} ${JSON.stringify(record[key])}`).join(", ")}, where the write states ${differing.map(([key, value]) => `${key} ${JSON.stringify(value)}`).join(", ")}`,
			);
		return record;
	});
}

/** The version of a record the store held before it counted writes. */
const UNCOUNTED = "0";

/** The key of a record in a store's versions. */
const keyOf = ({ label, id }: TRecordName): string => JSON.stringify([label, id]);

/**
 * The versions of the records a store holds in memory. Each write that changes a record's fields gives the record the next
 * number of the store's writes, so two writes of one record never state one version. A record the store held before it
 * counted writes, such as one a device loaded, holds version 0 until a write changes it.
 */
export class RecordVersions {
	private readonly versions = new Map<string, number>();
	private writes = 0;

	/** Returns the version of the record `name` names, where `held` states that the store holds it, or null. */
	of(name: TRecordName, held: boolean): TReadVersion {
		if (!held) return null;
		const counted = this.versions.get(keyOf(name));
		return counted === undefined ? UNCOUNTED : String(counted);
	}

	/** Refuses the units whose records changed since their callers read them: each states the version its verb states, and
	 *  whether the store holds its record. */
	check(units: ReadonlyArray<{ name: TRecordName; version: TReadVersion | undefined; held: boolean }>): void {
		for (const { name, version, held } of units) assertReadVersion(name, version, this.of(name, held));
	}

	/** Gives the record `name` names its next version, after a write of it. A store calls it once the write is held, so a read of
	 *  a version never precedes the fields it versions. */
	changed(name: TRecordName): void {
		this.versions.set(keyOf(name), ++this.writes);
	}

	/** Removes the version of a record the store no longer holds. */
	removed(name: TRecordName): void {
		this.versions.delete(keyOf(name));
	}
}

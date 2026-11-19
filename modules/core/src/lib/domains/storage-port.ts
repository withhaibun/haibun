/**
 * The files port a storage publishes for the FilePath domain's property readers, held on `world.runtime` under
 * `STORAGE_FILES`, the way the graph stepper holds the graph store.
 */
import type { TWorld } from "../actuality/domains/world.js";

/** The runtime key of the files port a storage publishes. */
export const STORAGE_FILES = "storage-files";

/** What the FilePath property readers need of a storage's files. A storage's port satisfies it structurally. */
type TStorageFilesPort = { readFile(path: string, coding?: string): string | Buffer; lstatToIFile(file: string): Promise<{ size: number }>; exists(path: string): boolean };

/** The files of the storage actuality loaded. Throws naming what to run where actuality loaded a feature without one. */
export function storageFilesOf(world: TWorld, path: unknown): TStorageFilesPort {
	const files = (world.runtime as Record<string, unknown>)[STORAGE_FILES] as TStorageFilesPort | undefined;
	if (files === undefined) throw new Error(`${String(path)} can't be read: actuality doesn't hold a storage; run a feature whose steppers include one.`);
	return files;
}

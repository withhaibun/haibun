import type { DirectoryJSON, IFs } from "memfs";
import { AStorage } from "@haibun/domain-storage/domains/storage.js";
import { memoryStorage } from "./root.js";

/** The storage that keeps files in a volume in memory. Each storage's volume starts with the files `BASE_FS` names. */
export default class StorageMem extends AStorage {
	static BASE_FS: DirectoryJSON = {};
	readonly volume: IFs;
	constructor() {
		const files = memoryStorage(StorageMem.BASE_FS);
		super(files);
		this.volume = files.volume;
	}
}

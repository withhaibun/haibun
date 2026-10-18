import { AStorage } from "@haibun/domain-storage/domains/storage.js";
import { fileSystemStorage } from "./root.js";

/** The storage that keeps files on the file system. */
export default class StorageFS extends AStorage {
	constructor() {
		super(fileSystemStorage());
	}
}

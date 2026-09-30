import * as fs from "fs";
import { dirname } from "path";

import { AStorage, CREATE_ONLY } from "@haibun/domain-storage/AStorage.js";
import { IFile } from "@haibun/domain-storage/domain-storage.js";

/** A file and a directory only their owner reads. */
const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;

export default class StorageFS extends AStorage {
	readFile = (file: string, coding?: BufferEncoding) => fs.readFileSync(file, coding);
	exists = fs.existsSync;
	writeFileBuffer = (fn: string, contents: Buffer) => {
		fs.writeFileSync(fn, new Uint8Array(contents));
	};
	lstatToIFile(file: string) {
		const l = fs.lstatSync(file);
		const ifile = {
			name: file,
			size: l.size,
			created: l.mtime.getTime(),
			isDirectory: l.isDirectory(),
			isFile: l.isFile(),
		};
		return Promise.resolve(<IFile>ifile);
	}
	readdir = (dir: string) => {
		try {
			return Promise.resolve(fs.readdirSync(dir));
		} catch (e) {
			console.error(`can't read ${dir}`);
			throw e;
		}
	};

	writePrivateFile = (file: string, contents: string) => {
		fs.mkdirSync(dirname(file), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
		fs.writeFileSync(file, contents, { mode: OWNER_ONLY_FILE, flag: CREATE_ONLY });
	};
	mkdir = fs.mkdirSync;
	mkdirp = (dir: string) => {
		fs.mkdirSync(dir, { recursive: true });
	};
	rm = fs.unlinkSync;
}

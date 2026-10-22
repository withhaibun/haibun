/** The files of a storage on the file system. A private file and its directory are readable by their owner alone. */
import * as fs from "fs";
import { dirname } from "path";
import { CREATE_ONLY } from "@haibun/domain-storage/adapters/write-flags.js";
import type { IFile, TStorageFiles } from "@haibun/domain-storage/ports.js";

/** A file and a directory only their owner reads. */
const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;

export const fileSystemFiles: TStorageFiles = {
	readFile: (file, coding) => fs.readFileSync(file, coding),
	exists: (path) => fs.existsSync(path),
	realpath: (path) => fs.realpathSync(path),
	writeFileBuffer: (file, contents) => fs.writeFileSync(file, new Uint8Array(contents)),
	lstatToIFile(file) {
		const l = fs.lstatSync(file);
		const ifile: IFile = { name: file, size: l.size, created: l.mtime.getTime(), isDirectory: l.isDirectory(), isFile: l.isFile() };
		return Promise.resolve(ifile);
	},
	readdir(dir) {
		try {
			return Promise.resolve(fs.readdirSync(dir));
		} catch (e) {
			console.error(`can't read ${dir}`);
			throw e;
		}
	},
	writePrivateFile(file, contents) {
		fs.mkdirSync(dirname(file), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
		fs.writeFileSync(file, contents, { mode: OWNER_ONLY_FILE, flag: CREATE_ONLY });
	},
	mkdir: (dir) => fs.mkdirSync(dir),
	mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
	rm: (file) => fs.unlinkSync(file),
};

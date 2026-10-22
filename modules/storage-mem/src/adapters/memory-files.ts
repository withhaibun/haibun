/** The files of a storage in a volume in memory, which starts with the files a directory listing names. */
import { Volume, type IFs, type DirectoryJSON } from "memfs";
import { dirname } from "path";
import { CREATE_ONLY } from "@haibun/domain-storage/adapters/write-flags.js";
import type { IFile, TStorageFiles } from "@haibun/domain-storage/ports.js";

/** The files of a new volume that holds `base`, and the volume. */
export function memoryFiles(base: DirectoryJSON): TStorageFiles & { volume: IFs } {
	const volume = <IFs>Volume.fromJSON(base);
	const mkdirp = (dir: string): void => {
		volume.mkdirSync(dir, { recursive: true });
	};
	return {
		volume,
		exists: (path) => volume.existsSync(path),
		realpath: (path) => volume.realpathSync(path).toString(),
		mkdir: (dir) => volume.mkdirSync(dir),
		mkdirp,
		readFile: (file, coding) => volume.readFileSync(file, coding),
		writeFileBuffer: (file, contents) => volume.writeFileSync(file, contents),
		lstatToIFile(file) {
			const l = volume.lstatSync(file);
			return Promise.resolve(<IFile>{ name: file, created: l.mtimeMs, isDirectory: l.isDirectory(), isFile: l.isFile() });
		},
		readdir(dir) {
			try {
				return Promise.resolve(volume.readdirSync(dir).map((i) => i.toString()));
			} catch (e) {
				console.error("StorageMem readdir failed", dir, JSON.stringify(volume, null, 2), e);
				throw e;
			}
		},
		writePrivateFile(file, contents) {
			mkdirp(dirname(file));
			volume.writeFileSync(file, contents, { flag: CREATE_ONLY });
		},
		rm: (file) => volume.unlinkSync(file),
	};
}

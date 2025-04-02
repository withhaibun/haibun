import { Volume, IFs, DirectoryJSON } from 'memfs';

import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { IFile } from '@haibun/domain-storage/build/domain-storage.js';
import { TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { toTreeSync } from 'memfs/lib/print/index.js';

export default class StorageMem extends AStorage {
	static BASE_FS: DirectoryJSON = {};
	volume: IFs;
	exists: (file: string) => boolean;
	mkdir: (dir: string) => void;
	constructor() {
		super();
		this.volume = <IFs>Volume.fromJSON(StorageMem.BASE_FS);
		this.exists = (dir) => this.volume.existsSync(dir);
		this.mkdir = (dir) => this.volume.mkdirSync(dir);
	}
	readFile = (file: string, coding?: TAnyFixme) => this.volume.readFileSync(file, coding);
	writeFileBuffer = (fn: string, contents: Buffer) => {
		this.volume.writeFileSync(fn, contents);
	};
	async lstatToIFile(file: string) {
		const l = this.volume.lstatSync(file);
		const ifile = {
			name: file,
			created: l.mtimeMs,
			isDirectory: l.isDirectory(),
			isFile: l.isFile(),
		};
		return Promise.resolve(<IFile>ifile);
	}
	debug(where: string) {
		console.debug(toTreeSync(this.volume, { dir: where || process.cwd() }));
	}
	readdir = async (dir: string) => {
		try {
			const ret = this.volume.readdirSync(dir).map((i) => i.toString());
			return Promise.resolve(ret);
		} catch (e) {
			console.error('StorageMem readdir failed', dir, JSON.stringify(this.volume, null, 2), e);
			throw e;
		}
	};

	mkdirp = (dir: string) => {
		this.volume.mkdirSync(dir, { recursive: true });
	};

	rm = (file: string) => {
		this.volume.unlinkSync(file);
	}
}

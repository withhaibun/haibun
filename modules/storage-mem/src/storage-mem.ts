import { Volume, IFs } from 'memfs';

import { AStorage, IFile } from '@haibun/domain-storage/build/AStorage.js';

export default class StorageMem extends AStorage {
    memFS: IFs;
    exists: (file: string) => boolean;
    mkdir: (dir: string) => void;
    constructor() {
        super();
        this.memFS = <IFs>Volume.fromJSON({});
        this.exists = (dir) => this.memFS.existsSync(dir);
        this.mkdir = (dir) => this.memFS.mkdirSync(dir);
    }
    readFile = (file: string, coding?: any) => this.memFS.readFileSync(file, coding);
    writeFileBuffer = (fn: string, contents: Buffer) => {
        this.memFS.writeFileSync(fn, contents);
    }
    lstatToIFile(file: string) {
        const l = this.memFS.lstatSync(file);
        const ifile = {
            name: file,
            created: l.mtime.getDate(),
            isDirectory: l.isDirectory(),
            isFile: l.isFile()
        }
        return <IFile>ifile;
    }
    readdir = async (dir: string) => {
        try {
            return this.memFS.readdirSync(dir).map(i => i.toString());
        } catch (e) {
            console.error(`can't read ${dir}`);
            throw (e);
        }
    }
    async readdirStat(dir: string): Promise<IFile[]> {
        const files = await this.readdir(dir);
        return files.map(f => this.lstatToIFile(`${dir}/${f}`));
    }

    mkdirp = (dir: string) => {
        this.memFS.mkdirSync(dir, { recursive: true });
    }
}


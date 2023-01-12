import * as fs from 'fs';

import { AStorage, IFile } from '@haibun/domain-storage/build/AStorage.js';

export default class StorageFS extends AStorage {
    readFile = (file: string, coding?: any) => fs.readFileSync(file, coding)
    exists = fs.existsSync;
    writeFileBuffer = (fn: string, contents: Buffer) => {
        fs.writeFileSync(fn, contents);;
    }
    lstatToIFile(file: string) {
        const l = fs.lstatSync(file);
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
            return fs.readdirSync(dir);
        } catch (e) {
            console.error(`can't read ${dir}`);
            throw (e);
        }
    }
    async readdirStat(dir: string): Promise<IFile[]> {
        const files = await this.readdir(dir);
        return files.map(f => this.lstatToIFile(`${dir}/${f}`));
    }

    mkdir = fs.mkdirSync;
    mkdirp = (dir: string) => {
        fs.mkdirSync(dir, { recursive: true });
    }
}


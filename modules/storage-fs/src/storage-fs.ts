import * as fs from 'fs';

import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { IFile } from '@haibun/domain-storage/build/domain-storage.js';

export default class StorageFS extends AStorage {
    readFile = (file: string, coding?: any) => fs.readFileSync(file, coding)
    exists = fs.existsSync;
    writeFileBuffer = (fn: string, contents: Buffer) => {
        fs.writeFileSync(fn, contents);
    }
    async lstatToIFile(file: string) {
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

    mkdir = fs.mkdirSync;
    mkdirp = (dir: string) => {
        fs.mkdirSync(dir, { recursive: true });
    }
}


import * as fs from 'fs';

import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { IFile, TPathedOrString, actualPath } from '@haibun/domain-storage/build/domain-storage.js';
import { TAnyFixme } from '@haibun/core/build/lib/defs.js';

export default class StorageFS extends AStorage {
    readFile = (file: string, coding?: TAnyFixme) => fs.readFileSync(file, coding)
    exists = fs.existsSync;
    writeFileBuffer = (fn: TPathedOrString, contents: Buffer) => {
        fs.writeFileSync(actualPath(fn), contents);
    }
    async lstatToIFile(file: string) {
        const l = fs.lstatSync(file);
        const ifile = {
            name: file,
            size: l.size,
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
    rm = fs.unlinkSync;
}


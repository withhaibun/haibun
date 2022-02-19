import { readFileSync, existsSync, writeFileSync, statSync, readdirSync } from 'fs';

import { AStorage } from '@haibun/domain-storage/build/defs';

export default class StorageFS extends AStorage {
    readFile = (file: string, coding?: any) => readFileSync(file, coding)
    exists = existsSync;
    writeFile = (fn: string, contents: Buffer) => {
        console.log(fn);
        
        writeFileSync(fn, contents);;
    }
    stat = statSync;
    readdir = (dir: string) => {
        try {
            return readdirSync(dir);
        } catch (e) {
            console.log(`can't read ${dir}`);
            throw (e);
        }
    }
}


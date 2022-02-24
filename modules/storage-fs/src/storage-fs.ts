import * as fs from 'fs';

import { AStorage } from '@haibun/domain-storage/build/AStorage';

export default class StorageFS extends AStorage {
    readFile = (file: string, coding?: any) => fs.readFileSync(file, coding)
    exists = fs.existsSync;
    writeFileBuffer = (fn: string, contents: Buffer) => {
        console.log(fn);
        
        fs.writeFileSync(fn, contents);;
    }
    stat = fs.statSync;
    readdir = (dir: string) => {
        try {
            return fs.readdirSync(dir);
        } catch (e) {
            console.log(`can't read ${dir}`);
            throw (e);
        }
    }
    mkdir = fs.mkdirSync;
    mkdirp = (dir: string) => {
        fs.mkdirSync(dir, {recursive: true});
    }
}


import { CAPTURE, AStepper, OK, TNamed, DEFAULT_DEST } from "@haibun/core/build/lib/defs.js"
import { actionNotOK } from '@haibun/core/build/lib/util/index.js';
import { setShared } from "@haibun/core/build/steps/vars.js";
import { IFile, TLocationOptions, TMediaType } from "./domain-storage.js";
import { Timer } from "@haibun/core/build/lib/Timer.js";

export abstract class AStorage extends AStepper {
    abstract readFile(path: string, coding?: string): any;
    abstract readdir(dir: string): Promise<string[]>;
    abstract lstatToIFile(file: string): Promise<IFile>;
    abstract writeFileBuffer(file: string, contents: Buffer, mediaType: TMediaType): void;

    async readTree(dir: string) {
        const entries = await this.readdirStat(dir);
        const tree = [];
        for (const e of entries) {
            if (e.isDirectory) {
                const sub = await this.readTree(e.name.replace(/^\/\//, '/'));
                tree.push({ ...e, entries: sub });
            } else {
                tree.push(e);
            }
        }
        return tree;
    }

    async readdirStat(dir: string): Promise<IFile[]> {
        const files = await this.readdir(dir);
        const mapped = [];
        for (const file of files) {
            const f = await this.lstatToIFile(`${dir}/${file}`);
            mapped.push(f);
        }
        return mapped;
    }
    async writeFile(file: string, contents: string | Buffer, mediaType: TMediaType) {
        if (typeof contents === 'string') {
            await this.writeFileBuffer(file, Buffer.from(contents), mediaType);
        } else {
            await this.writeFileBuffer(file, contents as Buffer, mediaType);
        }
    }
    async latestFrom(dir: string) {
        const orderReccentFiles = async (dir: string) =>
            (await this.readdirStat(dir))
                .filter(f => f.isFile)
                .sort((a, b) => b.created - a.created);
        return orderReccentFiles(dir)[0];
    }

    abstract mkdir(dir: string);
    abstract mkdirp(dir: string);
    abstract exists(ntt: string);

    async rmrf(dir: string) {
        throw Error(`rmrf not implemented at ${dir}`);
    }

    fromCaptureLocation(mediaType: TMediaType, ...where: string[]) {
        return [`./${CAPTURE}`, ...where].join('/');
    }

    locator(loc: TLocationOptions, ...where: (string | undefined)[]) {
        const { options } = loc;
        const path = [options.base, CAPTURE, options.DEST || DEFAULT_DEST].concat(where.filter(w => w !== undefined));
        return '.' + path.join('/');
    }

    async getCaptureLocation(loc: TLocationOptions, app?: string) {
        const { tag } = loc;
        const locator = this.locator(loc, `${tag.when}`, `loop-${tag.loop}`, `seq-${tag.sequence}`, `featn-${tag.featureNum}`, `mem-${tag.member}`, app);
        return locator;
    }

    /**  
     * Overload this where slash directory conventions aren't used.
     * Should not be used for any storage method that writes (that should be done in the function).
     * @param relativeTo - flag to return a relative location
     */
    pathed(mediaType: TMediaType, f: string, relativeTo?: string) {
        if (relativeTo) {
            return f.replace(relativeTo, '.');
        }

        return f;
    }

    async ensureCaptureLocation(loc: TLocationOptions, app?: string | undefined, fn = '') {
        const dir = await this.getCaptureLocation(loc, app);
        await this.ensureDirExists(dir);
        return `${dir}/${fn}`;
    }
    async ensureDirExists(dir: string) {
        if (!this.exists(dir)) {
            try {
                this.mkdirp(dir);
            } catch (e) {
                throw Error(`creating ${dir}: ${e}`)
            }
        }
    }

    steps = {
        fromFile: {
            gwta: `from {where} set {what}`,
            action: async ({ where, what }: TNamed, vstep) => {
                const text = await this.readFile(where, 'utf-8');
                setShared({ what, value: text }, vstep, this.getWorld());

                return OK;
            }
        },
        testIs: {
            gwta: `text at {where} is {what}`,
            action: async ({ where, what }: TNamed) => {
                const text = await this.readFile(where, 'utf-8');
                return text === what ? OK : actionNotOK(`text at ${where} is not ${what}; it's ${text}`);
            }
        },
        readText: {
            gwta: `read text from {where}`,
            action: async ({ where }: TNamed) => {
                const text = await this.readFile(where, 'utf-8');
                this.getWorld().logger.log(text);
                return OK;
            }
        },
        listFiles: {
            gwta: `list files from {where}`,
            action: async ({ where }: TNamed) => {
                const files = await this.readdir(where);
                this.getWorld().logger.log(`files from ${where}: ${files.join(', ')}`);
                return OK;
            }
        },
        clearFiles: {
            gwta: `clear files matching {where}`,
            action: async ({ where }: TNamed) => {
                const dirs = where.split(',').map(d => d.trim());
                for (const dir of dirs) {
                    await this.rmrf(dir);
                }
                return OK;
            }
        },
        clearAllFiles: {
            gwta: `clear files`,
            action: async () => {
                await this.rmrf('');
                return OK;
            }
        },
        isTheSame: {
            gwta: `{what} is the same as {where}`,
            action: async ({ what, where }: TNamed) => {
                const c1 = this.readFile(what, 'binary');
                const c2 = this.readFile(where, 'binary');
                return Buffer.from(c1)?.equals(Buffer.from(c2)) ? OK : actionNotOK(`contents are not the same ${what} ${where}`);
            }
        }
    }
}
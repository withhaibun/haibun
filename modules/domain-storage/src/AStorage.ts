import { CAPTURE, AStepper, OK, TNamed, DEFAULT_DEST, } from "@haibun/core/build/lib/defs";
import { setShared } from "@haibun/core/src/steps/vars";
import { TLocationOptions, TMediaType } from "./domain-storage";

export interface IFile {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    created: number;
}

export abstract class AStorage extends AStepper {
    abstract readFile(path: string, coding?: string): any;
    abstract readdir(dir: string): Promise<string[]>;
    abstract readdirStat(dir: string): Promise<IFile[]>;
    abstract writeFileBuffer(file: string, contents: Buffer, mediaType: TMediaType): void;

    async writeFile(file: string, contents: string | Buffer, mediaType: TMediaType) {
        if (typeof contents === 'string') {
            await this.writeFileBuffer(file, Buffer.from(contents), mediaType);
        }
        await this.writeFileBuffer(file, contents as Buffer, mediaType);
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
        return this.locator(loc, `loop-${tag.loop}`, `seq-${tag.sequence}`, `featn-${tag.featureNum}`, `mem-${tag.member}`, app);
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
        setLatest: {
            gwta: `set {what} to the latest file from {where}`,
            action: async ({ where, what }: TNamed, vstep) => {
                const latest = await this.latestFrom(where);
                setShared({ what, value: latest.file }, vstep, this.getWorld());

                return OK;
            }
        },
        readFile: {
            gwta: `read text from {where: STORAGE_ITEM}`,
            action: async ({ where }: TNamed) => {
                const text = await this.readFile(where, 'utf-8');
                this.getWorld().logger.log(text);
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
        }
    }
}

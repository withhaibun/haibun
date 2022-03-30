import { CAPTURE, AStepper, OK, TNamed, TOptions, TResult, TTag, TWorld, DEFAULT_DEST, } from "@haibun/core/build/lib/defs";
import { dirname } from "path";
import { EMediaTypes, TLocationOptions, TMediaType } from "./domain-storage";

export abstract class AStorage extends AStepper {
    abstract readFile(path: string, coding?: string): any;
    abstract readdir(dir: string): any;
    abstract writeFileBuffer(file: string, contents: Buffer, mediaType: TMediaType): void;

    async writeFile(file: string, contents: string | Buffer, mediaType: TMediaType) {
        if (typeof contents === 'string') {
            await this.writeFileBuffer(file, Buffer.from(contents), mediaType);
        }
        await this.writeFileBuffer(file, contents as Buffer, mediaType);
    }

    abstract stat(dir: string);
    abstract mkdir(dir: string);
    abstract mkdirp(dir: string);
    abstract exists(ntt: string);
    async rmrf(dir: string) {
        throw Error(`rmrf not implemented at ${dir}`);
    }

    fromCaptureDir(mediaType: TMediaType, ...where: string[]) {
        return [`./${CAPTURE}`, ...where].join('/');
    }

    locator(loc: TLocationOptions, ...where: (string | undefined)[]) {
        const { options } = loc;
        const path = [options.base, CAPTURE, options.DEST || DEFAULT_DEST].concat(where.filter(w => w !== undefined));
        return '.' + path.join('/');
    }

    async getCaptureDir(loc: TLocationOptions, app?: string) {
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

    async ensureCaptureDir(loc: TLocationOptions, app?: string | undefined, fn = '') {
        const dir = await this.getCaptureDir(loc, app);
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

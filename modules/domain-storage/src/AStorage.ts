import { CAPTURE, AStepper, OK, TLocationOptions, TNamed, TOptions, TResult, TTag, TWorld, DEFAULT_DEST } from "@haibun/core/build/lib/defs";
import { dirname } from "path";

export abstract class AStorage extends AStepper {
    abstract readFile(path: string, coding?: string): any;
    abstract readdir(dir: string): any;
    abstract writeFileBuffer(file: string, contents: Buffer): void;

    async writeFile(file: string, contents: string | Buffer) {
        const dir = dirname(file);
        await this.ensureDirExists(dir);

        if (typeof contents === 'string') {
            await this.writeFileBuffer(file, Buffer.from(contents));
        }
        await this.writeFileBuffer(file, contents as Buffer);
    }

    abstract stat(dir: string);
    abstract mkdir(dir: string);
    abstract mkdirp(dir: string);
    abstract exists(ntt: string);
    async rmrf(dir: string) {
        throw Error(`rmrf not implemented at ${dir}`);
    }

    fromCaptureDir(...where: string[]) {
        return [`./${CAPTURE}`, ...where].join('/');
    }

    locator(options: TOptions, ...where: (string | undefined)[]) {
        const path = [options.base, CAPTURE, options.DEST || DEFAULT_DEST].concat(where.filter(w => w !== undefined));
        return this.pathed('.' + path.join('/'));
    }

    async getCaptureDir({ options, tag }: { options: TOptions, tag: TTag }, app?: string) {
        return this.locator(options, `loop-${tag.loop}`, `seq-${tag.sequence}`, `featn-${tag.featureNum}`, `mem-${tag.member}`, app);
    }

    // overload this where / conventions aren't used
    pathed(f: string, relativeTo?: string) {
        if (relativeTo) {
            return f.replace(relativeTo, '.');
        }

        return f;
    }

    async writeTraceFile(world: TWorld, result: TResult) {
        const dir = await this.ensureCaptureDir(world, 'trace', `trace.json`);
        this.writeFile(dir, JSON.stringify(result, null, 2));
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
        }
    }
}

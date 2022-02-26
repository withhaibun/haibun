import { BASE_PREFIX, CAPTURE, AStepper, OK, TLocationOptions, TNamed, TOptions, TResult, TTag, TWorld } from "@haibun/core/build/lib/defs";

export abstract class AStorage extends AStepper {
    abstract readFile(path: string, coding?: string): any;
    abstract readdir(dir: string): any;
    abstract writeFileBuffer(file: string, contents: Buffer): void;

    async writeFile(file: string, contents: string | Buffer) {
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
        throw Error('not implemented');
    }

    async getCaptureDir({ options, tag }: { options: TOptions, tag: TTag }, app?: string) {
        const p = [options.base, options.CAPTURE_DIR || CAPTURE, `loop-${tag.loop}`, `seq-${tag.sequence}`, `featn-${tag.featureNum}`, `mem-${tag.member}`];
        app && p.push(app);
        return this.pathed('.' + p.join('/'));
    }

    // overload this where / conventions aren't used
    pathed(f: string) {
        return f;
    }

    async writeTraceFile(world: TWorld, result: TResult) {
        const dir = await this.ensureCaptureDir(world, 'trace', `trace.json`);
        this.writeFile(dir, JSON.stringify(result, null, 2));
    }

    async ensureCaptureDir(loc: TLocationOptions, app: string | undefined, fn = '') {
        const dir = await this.getCaptureDir(loc, app);
        if (!this.exists(dir)) {
            try {
                this.mkdirp(dir);
            } catch (e) {
                throw Error(`creating ${dir}: ${e}`)
            }
        }
        return `${dir}/${fn}`;
    }

    steps = {
        readFile: {
            gwta: `read text from {where: STORAGE_ITEM}`,
            action: async ({ where }: TNamed) => {
                const text = await this.readFile(where, 'utf-8');
                return OK;
            }
        }
    }
}

export const BASE_STORAGE = `${BASE_PREFIX}STORAGE`;
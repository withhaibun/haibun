import { CAPTURE, AStepper, OK, TNamed, DEFAULT_DEST, TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { actionNotOK } from '@haibun/core/build/lib/util/index.js';
import { setShared } from '@haibun/core/build/steps/vars.js';
import { IFile, TLocationOptions, TPathedOrString } from './domain-storage.js';
import { EMediaTypes, TMediaType } from './media-types.js';

type TTree = Array<IFile | IFileWithEntries>;

interface IFileWithEntries extends IFile {
  entries: TTree;
}
export abstract class AStorage extends AStepper {
  abstract readFile(path: string, coding?: string): TAnyFixme;
  abstract rm(path: string);
  abstract readdir(dir: string): Promise<string[]>;
  abstract lstatToIFile(file: string): Promise<IFile>;
  abstract writeFileBuffer(file: TPathedOrString, contents: Buffer, mediaType: TMediaType): void;

  async readTree(dir: string, filter?: string): Promise<TTree> {
    const entries = await this.readdirStat(dir);
    const tree = [];
    for (const e of entries) {
      if (e.isDirectory) {
        const sub = await this.readTree(e.name.replace(/^\/\//, '/'), filter);
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
  async writeFile(file: TPathedOrString, contents: string | Buffer, mediaType: TMediaType) {
    if (typeof contents === 'string') {
      await this.writeFileBuffer(file, Buffer.from(contents), mediaType);
    } else {
      await this.writeFileBuffer(file, contents as Buffer, mediaType);
    }
  }

  async latestFrom(dir: string) {
    const orderReccentFiles = async (dir: string) => (await this.readdirStat(dir)).filter((f) => f.isFile).sort((a, b) => b.created - a.created);
    return orderReccentFiles(dir)[0];
  }

  abstract mkdir(dir: string);
  abstract mkdirp(dir: string);
  abstract exists(ntt: string);

  async rmrf(dir: string) {
    throw Error(`rmrf not implemented at ${dir}`);
  }

  fromCaptureLocation(mediaType: TMediaType, ...where: string[]) {
    return this.fromLocation(mediaType, ...[`./${CAPTURE}`, ...where]);
  }

  /**
   * Returns a storage specific resolved path for a given media type.
   * Overload this where slash directory conventions aren't used.
   * 
   * @param mediaType 
   * @param where 
   * @returns string
   */
  fromLocation(mediaType: TMediaType, ...where: string[]) {
    return where.join('/');
  }

  locator(loc: TLocationOptions, ...where: (string | undefined)[]) {
    const { options } = loc;
    const path = [options.base, CAPTURE, options.DEST || DEFAULT_DEST].concat(where.filter((w) => w !== undefined));
    return '.' + path.join('/');
  }

  async getCaptureLocation(loc: TLocationOptions, app?: string) {
    const { tag } = loc;
    const locator = this.locator(loc, tag.key, `loop-${tag.loop}`, `seq-${tag.sequence}`, `featn-${tag.featureNum}`, `mem-${tag.member}`, app);
    return locator;
  }

  /**
   * Overload this where slash directory conventions aren't used.
   * Should not be used for any storage method that writes (that should be done in the function).
   * @param relativeTo - flag to return a relative location
   */
  pathed(mediaType: TMediaType, f: string, relativeTo?: string) {
    if (relativeTo) {
      return (f || 'FIXMEPATHED').replace(relativeTo, '.');
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
        throw Error(`creating ${dir}: ${e}`);
      }
    }
  }

  steps = {
    createFile: {
      gwta: `create file at {where} with {what}`,
      action: async ({ where, what }: TNamed) => {
        await this.writeFile(where, what, EMediaTypes.html);
        return OK;
      },
    },
    createDirectory: {
      gwta: `create directory at {where}`,
      action: async ({ where }: TNamed) => {
        await this.mkdirp(where);
        return OK;
      },
    },
    filesCount: {
      gwta: `directory {where} has {count} files`,
      action: async ({ where, count }: TNamed) => {
        const files = await this.readdir(where);
        return files.length === parseInt(count) ? OK : actionNotOK(`directory ${where} has ${files.length} files`);
      },
    },
    fromFile: {
      gwta: `from {where} set {what}`,
      action: async ({ where, what }: TNamed, vstep) => {
        const text = await this.readFile(where, 'utf-8');
        setShared({ what, value: text }, vstep, this.getWorld());

        return OK;
      },
    },
    testIs: {
      gwta: `text at {where} is {what}`,
      action: async ({ where, what }: TNamed) => {
        const text = await this.readFile(where, 'utf-8');
        return text === what ? OK : actionNotOK(`text at ${where} is not ${what}; it's ${text}`);
      },
    },
    readText: {
      gwta: `read text from {where}`,
      action: async ({ where }: TNamed) => {
        const text = await this.readFile(where, 'utf-8');
        this.getWorld().logger.log(text);
        return OK;
      },
    },
    listFiles: {
      gwta: `list files from {where}`,
      action: async ({ where }: TNamed) => {
        const files = await this.readdir(where);
        this.getWorld().logger.log(`files from ${where}: ${files.join(', ')}`);
        return OK;
      },
    },
    clearFiles: {
      gwta: `clear files matching {where}`,
      action: async ({ where }: TNamed) => {
        const dirs = where.split(',').map((d) => d.trim());
        for (const dir of dirs) {
          await this.rmrf(dir);
        }
        return OK;
      },
    },
    fileExists: {
      gwta: `storage entry {what} exists`,
      action: async ({ what }: TNamed) => {
        const exists = this.exists(what);
        return exists ? OK : actionNotOK(`file ${what} does not exist`);
      },
    },
    clearAllFiles: {
      exact: `clear files`,
      action: async () => {
        await this.rmrf('');
        return OK;
      },
    },
    isTheSame: {
      gwta: `{what} is the same as {where}`,
      action: async ({ what, where }: TNamed) => {
        const c1 = this.readFile(what, 'binary');
        const c2 = this.readFile(where, 'binary');
        return Buffer.from(c1)?.equals(Buffer.from(c2)) ? OK : actionNotOK(`contents are not the same ${what} ${where}`);
      },
    },
  };
}

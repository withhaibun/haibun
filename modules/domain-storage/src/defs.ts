import { AStepper, OK, TNamed } from "@haibun/core/build/lib/defs";

export abstract class AStorage extends AStepper {
    abstract readFile(path: string, coding: string): any;
    abstract readdir(dir: string): any;
    abstract writeFile(file: string, contents: Buffer);
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
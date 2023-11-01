import { TExecutorResultError } from "@haibun/core/build/lib/defs.js";
import { ILogger } from "@haibun/core/build/lib/interfaces/logger.js";
import { WEB_PAGE } from "@haibun/domain-webpage";
import { TFeatureParsed } from "./defs.js";

export default abstract class BaseFeatureImporter {
    stored: { [tag: string]: number } = {};
    tags: { [tag: string]: string | number } = {};
    backgrounds: { [pageName: string]: { [tag: string]: string | number } } = {};
    currentPageTag: string | undefined = undefined;
    statements: string[] = [];
    inputBuffered: { input: string, selector: string } | undefined = undefined;
    logger: ILogger;

    constructor(logger: ILogger) {
        this.logger = logger;
    }

    abstract getResult(): TFeatureParsed | TExecutorResultError;

    setCurrentPage(address: string) {
        const tag = this.getTag(WEB_PAGE, address);
        this.currentPageTag = tag;
        if (!this.backgrounds[tag]) {
            this.backgrounds[tag] = {
                '[HERE]': address
            }
        }
        return tag;
    }

    variableQuoted = (tag: string) => '`' + tag + '`';

    bg = (what: string, val: string | number) => {
        if (!this.currentPageTag) {
            throw Error(`missing current page for background`);
        }
        const tag = what === WEB_PAGE ? '[HERE]' : this.getTag(what, val);
        const set = { [tag]: val };
        this.backgrounds[this.currentPageTag] = { ...this.backgrounds[this.currentPageTag], ...set };
        return tag;
    }

    private getTag(what: string, val: string | number) {
        const already = Object.keys(this.tags).find(k => this.tags[k] === val);
        if (already) {
            return already;
        }
        let num = this.stored[what] || 0;
        this.stored[what] = ++num;
        const tag = `${what}${num}`;
        this.tags[tag] = val;
        return tag;
    }
}


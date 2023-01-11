
import { TFeatureError, TFeatureParsed } from "./defs";

const PAGE = 'Page';
const WIDTH = 'Width';
const HEIGHT = 'Height';
const SELECTOR = 'Selector';

export function getFeatures(parsed: string): TFeatureError | TFeatureParsed {
    const stored: { [tag: string]: number } = {};
    const tags: { [tag: string]: string | number } = {};
    const backgrounds: { [pageName: string]: { [tag: string]: string | number } } = {};
    let currentPageTag: string | undefined = undefined;
    const bq = (what: string, val: string | number, isCurrent: boolean = false) => {
        return vq(bg(what, val, isCurrent));
    }

    const vq = (tag: string) => '`' + tag + '`';

    const bg = (what: string, val: string | number, isCurrent = false) => {
        let num = stored[what] || 0;
        stored[what] = ++num;
        const tag = `${what}${num}`;
        tags[tag] = val;
        if (isCurrent) {
            currentPageTag = tag;
        }
        const set = { [tag]: val };
        if (currentPageTag) {
            backgrounds[currentPageTag] = backgrounds[currentPageTag] ? { ...backgrounds[currentPageTag], ...set } : set;
        }

        return tag;
    }
    const page = {
        feature: <string[]>[],
        goto(where: string) {
            currentPageTag = bg(PAGE, where, true);
            this.feature.push(`go to ${vq(currentPageTag)}`);
        },
        setViewportSize({ width, height }: { width: number, height: number }) {
            this.feature.push(`Set viewport to ${bq(WIDTH, width)}, ${bq(HEIGHT, height)}`);
        },
        waitForSelector(sel: string) {
            this.feature.push(`wait for ${bq(SELECTOR, sel)}`);
        },
        click(what: string) {
            this.feature.push(`click ${bq(SELECTOR, what)}`)
        },
    }
    const navigationPromise = (...args: any) => {
    }
    parsed = parsed.replace(/await/g, 'this.');
    try {
        (new Function(parsed)).call({ page, navigationPromise });
    } catch (e: any) {
        return {
            ok: false,
            error: e
        }
    }
    return {
        ok: true,
        backgrounds,
        feature: page.feature.join('\n')
    }
}


module.exports = { getFeatures };
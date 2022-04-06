import { friendlyTime } from "@haibun/core/build/lib/util";
import { led } from "../led";
import { TIndexSummary } from "../../html-generator";

export const toc = (results: TIndexSummary[], dir: string, uriArgs: string | undefined, linker: (what: string) => string, pather: (what: string) => string) => {
    const index: any = {
        h1: {
            '@id': linker(dir),
            '#': dir,
        },
        ul: {
            '@class': 'no-bullets',
            li: []

        }
    }
    for (const r of results) {
        const { ok, path, title, startTime } = r;
        const destPath = pather(path)

        index.ul.li.push({
            a: {
                '@href': `${destPath}${uriArgs}`,
                '#': `${led(ok)} ${title} ${friendlyTime(startTime)}`
            }
        });
    }
    return index;
}
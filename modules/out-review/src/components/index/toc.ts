import { friendlyTime } from "@haibun/core/build/lib/util/index.js";
import { led } from "../led.js";
import { TIndexSummary } from "../../html-generator.js";

export const toc = (summary: TIndexSummary, dir: string, uriArgs: string | undefined, linker: (what: string) => string, pather: (what: string) => string) => {
    const {indexTitle, results} = summary;
    
    const index: any = {
        h1: {
            '@data-testid': 'review-title',
            '@id': linker(dir),
            '#': indexTitle,
        },
        ul: {
            '@class': 'no-bullets',
            li: []

        }
    }
    for (const r of results) {
        const { ok, sourcePath, featureTitle, startTime } = r;
        const destPath = pather(sourcePath)

        index.ul.li.push({
            a: {
                '@href': `${destPath}${uriArgs}`,
                '#': `${led(ok)} ${featureTitle} ${friendlyTime(new Date(Date.parse(startTime!)))}`
            }
        });
    }
    return index;
}
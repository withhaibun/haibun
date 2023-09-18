import { friendlyTime } from "@haibun/core/build/lib/util/index.js";
import { led } from "../led.js";
import { TIndexSummary } from "../../html-generator.js";

export const toc = (summary: TIndexSummary, toDir: string, uriArgs: string | undefined) => {
    const { indexTitle, results } = summary;

    const index: any = {
        h1: {
            '@data-testid': 'review-title',
            '@id': toDir,
            '#': indexTitle,
        },
        ul: {
            '@class': 'no-bullets',
            li: []

        }
    }
    for (const r of results) {
        const { ok, sourcePath, featureTitle, startTime } = r;

        index.ul.li.push({
            a: {
                '@href': `${sourcePath}${uriArgs}`,
                '#': `${led(ok)} ${featureTitle} ${friendlyTime(new Date(Date.parse(startTime!)))}`
            }
        });
    }
    return index;
}
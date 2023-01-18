import { shortNum } from "@haibun/core/build/lib/util/index.js";
import { TStepSummary } from "../html-generator.js";
import { led } from "./led.js";


export const sourceSummary = (i: TStepSummary) => {
    const { sourcePath, ok, start } = i;
    const summary = {
        section: {
            a: {
                '@data-time': start,
                '@id': `start-${start}`,
                '@onclick': `setVideoTime(${start})`,
                span: [{
                    '#': `${sourcePath} @${shortNum(start)}`,
                },
                {
                    '#': `${led(ok)}  `,
                }]
            },
            div: [],
        }
    }

    return summary;
    }
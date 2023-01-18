import { StepCircleCSS } from "../../assets.js";
import { TIndexSummary } from "../../html-generator.js";

export const summary = (results: { ok: boolean, dir: string, link: string, index: TIndexSummary[] }[]) => {
    const summary = {
        style: {
            '#': StepCircleCSS
        },
        div: {
            '@class': 'index-header',
            ol: {
                '@class': 'steplist',
                li: <any>[],
            },
        },
        section: <any>[]
    }

    const li = results.map(r => ({
        li: {
            '@class': r.ok ? 'passed' : 'failed',
            a: {
                '@href': `#${r.link}`,
                '#': r.dir
            }
        }
    }));

    summary.div.ol.li = li;

    results.forEach(r => summary.section.push({
        ...r.index
    }));
    return summary;
}
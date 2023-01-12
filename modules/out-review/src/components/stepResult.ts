import { TStepSummary } from '../html-generator.js';
import { led } from "./led.js";
import { traces } from './traces.js';

export const stepResult = (i: TStepSummary, sectionStart: number) => {
    const { ok, seq, in: inStruction, name, topics, traces: allTraces, start } = i;
    const forHTML = {
        section: {
            '@class': 'step-result-section',
            div: <any>[],
        },
    }

    const feature = {
        div: {
            div: <any>[],
            section: {
                div: <any>[]
            }

        }
    }
    const o = {
        a: {
            '@data-time': start,
            '@data-start': sectionStart,
            '@id': `start-${start}`,
            '@onclick': `setVideoTime(${start})`,
            span: {
                span: {
                    '@class': 'step-result-line',
                    span: [{
                        '@class': 'step-result-seq',
                        '#': `${seq}`,
                    },
                    {
                        '#': ` ${name} `
                    }],
                },
                '#': `${led(ok)} ${inStruction}  `
            }
        },
        details: [(topics && {
            '#': JSON.stringify(topics),
            summary: {
                '#': 'topics'
            },
        }),
        allTraces && {
            '#': traces(allTraces, start),
            summary: {
                '#': `${allTraces.length} traces`,
            },
        },
        ]
    }
    feature.div.div.push(o);
    forHTML.section.div.push(feature);
    return forHTML;
}

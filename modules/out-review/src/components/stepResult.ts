import { TStepSummary } from '../html-generator';
import { led } from "./led";
import { traces } from './traces';

export const stepResult = (i: TStepSummary) => {
    const { ok, seq, in: inStruction, name, topics, traces: allTraces, start } = i;
    const forHTML = {
        section: {
            '@style': 'padding-top: 480',
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
            '@id': `start-${start}`,
            '@onclick': `setVideoTime(${start})`,
            span: {
                span: {
                    span: {
                        '@style': 'display: inline-block; width: 11em; color: #888',
                        span: [{
                            '@style': 'display: inline-block; background: black; color: white; padding: 2px; width: 2em; text-align: right',
                            '#': `${seq}`,
                        },
                        {
                            '#': ` ${name} `
                        }],
                    },
                    '#': `${led(ok)} ${inStruction}  `
                }
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
                span: {
                    '@style': 'background: yellow',
                    '@id': `current-${start}`
                }
            },
        },
        ]
    }
    feature.div.div.push(o);
    forHTML.section.div.push(feature);
    return forHTML;
}

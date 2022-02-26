import { TFeatureResult, TLocationOptions, TTrace, } from "@haibun/core/build/lib/defs";
import { AStorage } from "@haibun/domain-storage/build/AStorage";
import { EOL } from "os";
import { create } from "xmlbuilder2";
import { MISSING_TRACE } from "./out-reviews-stepper";
import ReviewScript from "./review-script";

const GREEN_CHECK = '✔️';
const RED_CHECK = '❌';

export default class GenerateHtml {
    traceStorage: AStorage;
    publishStorage: AStorage;
    uriArgs: string | undefined;
    constructor(traceStorage: AStorage, publishStorage: AStorage, uriArgs = '') {
        this.traceStorage = traceStorage;
        this.publishStorage = publishStorage;
        this.uriArgs = uriArgs;
    }

    async getIndex(traces: { loc: TLocationOptions, trace: TFeatureResult | typeof MISSING_TRACE }[]) {
        const index: any = {
            div: []
        }
        for (const t of traces) {
            const { loc, trace } = t;
            const where = this.publishStorage.pathed(await (await this.publishStorage!.getCaptureDir(loc)) + '/review.html');
            const mark = trace.ok ? GREEN_CHECK : RED_CHECK;
            index.div.push({
                li: {
                    a: {
                        '@href': `${where}${this.uriArgs}`,
                        '#': `${mark} ${loc.tag.featureNum} ${trace.path}`
                    }
                }
            });
        }
        return index;
    }
    async getFeatureResult(loc: TLocationOptions, storage: AStorage, result: TFeatureResult | typeof MISSING_TRACE) {
        const videoBase = await this.traceStorage!.getCaptureDir(loc, 'video');
        let video: object;
        try {
            const file = await storage.readdir(videoBase)[0];
            const src = this.publishStorage!.pathed(await this.publishStorage!.getCaptureDir(loc, 'video') + `/${file}`);
            video = {
                video: {
                    '@id': 'video',
                    '@controls': true,
                    '@height': 480,
                    '@width': 640,
                    '@autoplay': true,

                    source: {
                        '@type': 'video/webm',
                        '@src': `${src}${this.uriArgs}`,
                    }
                }
            };
        } catch (e) {
            video = {
                h1: {
                    '#': 'Video not available'
                }

            }
        }
        const forHTML: any = {
            h1: {
                '#': result.path
            },
            div: {
                '@id': 'videoDiv',
                '@style': 'width: 640, height: 480, position: fixed; top: 0, right: 0',
                ...video,
            },
            section: {
                '@style': 'padding-top: 480',
                div: []
            },
            script: {
                '@type': 'text/javascript',
                '#': '{{SCRIPT}}'
            },
        }

        const feature: any = {
            div: {
                '@style': 'border-top: 1px dotted grey; padding-top: 4em',
                a: {
                    '#': `Result: ${result.ok}`,
                },
                div: []
            }
        }

        if (result === MISSING_TRACE) {
            feature.div.div.push({
                h1: {
                    '#': 'Missing trace file'
                }
            })
        } else {
            for (const s of (result as TFeatureResult).stepResults) {
                for (const a of s.actionResults) {
                    const start = (a as any).start;
                    const o = {
                        '@style': 'padding-top: 1em',
                        a: {
                            '@data-time': start,
                            '@onclick': `setTime(${start})`,
                            b: {
                                b: {
                                    '#': `<<  `,
                                    span: [{
                                        '@style': 'background: black; color: white; padding: 5, width: 3em; text-align: right',
                                        '#': `${s.seq}`,
                                    },
                                    {
                                        '#': `${a.ok} ${a.name} ${s.in}  `
                                    }]

                                }
                            }
                        },
                        details: [(a.topics && {
                            '#': JSON.stringify(a.topics),
                            summary: {
                                '#': 'topics'
                            },
                        }),
                        ((a as any).traces && {
                            '#': this.traces(a),
                            summary: {
                                '#': 'trace'
                            },
                        }),
                        ]
                    }
                    feature.div.div.push(o);
                }
            }
        }

        forHTML.section.div.push(feature);
        return forHTML;
    }
    async getOutput(content: object, { title = 'Haibun-Review', prettyPrint = true }) {
        const forHTML: any = {
            html: {
                "@xmlns": "http://www.w3.org/1999/xhtml",
                "@style": "list-style-type: none; padding: 10px",
                head: {
                    meta: {
                        '@charset': 'utf-8'
                    }
                },
                link: [{
                    '@href': "https://fonts.googleapis.com/css2?family=Open+Sans&display=swap",
                    '@rel': "stylesheet"
                },
                {
                    '@href': "https://use.fontawesome.com/releases/v5.15.4/css/all.css",
                    '@rel': "stylesheet"
                },
                {
                    '@href': "https://www.canada.ca/etc/designs/canada/wet-boew/css/theme.min.css",
                    '@rel': "stylesheet"
                }],
                title,
                ...content,
            }
        }

        const created = create(forHTML).end({ prettyPrint, newline: EOL });
        const html = this.finish(created);
        return { html };
    }
    traces(a: any) {
        const { traces } = a;
        const byUrl = (traces as TTrace[]).map((i) => ({ url: i.response.trace.url, since: i.response.since, headersContent: i.response.trace.headersContent }));

        const ret = byUrl.map(({ url, since, headersContent }) => {
            const summary = {
                a: {
                    '@id': since,
                    '@data-time': since,
                    '@onclick': `setTime(${since})`,
                    '#': `${since} ${url}`,
                }
            }
            const ul = (headersContent as any).map((i: any) => ({
                li:
                {
                    '#': `${i.name}: ${i.value}`
                }
            }));

            return {
                details: {
                    ul,
                    summary
                }
            }
        });
        return ret;
    }
    finish(html: string) {
        html = html.replace('{{SCRIPT}}', ReviewScript);
        return html;
    }
}

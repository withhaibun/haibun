import { TFeatureResult, TLocationOptions, TTrace, } from "@haibun/core/build/lib/defs";
import { AStorage } from "@haibun/domain-storage/build/AStorage";
import { EOL } from "os";
import { create } from "xmlbuilder2";
import { MISSING_TRACE } from "./out-reviews-stepper";
import { AllCSS, ReviewScript, StepCircleCSS } from "./assets";

export type TINDEX_SUMMARY = {
    ok: boolean,
    path: string,
    title: string
}
const GREEN_CHECK = '✔️';
const RED_CHECK = '❌';

export default class HtmlGenerator {
    traceStorage: AStorage;
    publishStorage: AStorage;
    uriArgs: string | undefined;
    constructor(traceStorage: AStorage, publishStorage: AStorage, uriArgs = '') {
        this.traceStorage = traceStorage;
        this.publishStorage = publishStorage;
        this.uriArgs = uriArgs;
    }

    linkFor(what: string) {
        return `index_${what}`;
    }

    summarize(results: { ok: boolean, dir: string, link: string, index: TINDEX_SUMMARY[] }[]) {
        const summary: any = {
            style: {
                '#': StepCircleCSS
            },
            div: {
                '@class': 'index-header',
                ol: {
                    '@class': 'steplist',
                    li: [],
                },
            },
            section: []
        }

        const li = results.map(r => ({
            li: {
                '@class': r.ok ? 'passed' : 'failed',
                a: {
                    '@href': `capture/index.html#${r.link}`,
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
    getIndex(results: TINDEX_SUMMARY[], dir: string) {
        const index: any = {
            h1: {
                '@id': this.linkFor(dir),
                '#': dir,
            },
            ul: {
                '@class': 'no-bullets',
                li: []

            }
        }
        for (const r of results) {
            const { ok, path, title } = r;
            const mark = ok ? GREEN_CHECK : RED_CHECK;
            index.ul.li.push({
                a: {
                    '@href': `${path}${this.uriArgs}`,
                    '#': `${mark} ${title}`
                }
            });
        }
        return index;
    }
    async getFeatureResult(loc: TLocationOptions, storage: AStorage, result: TFeatureResult | typeof MISSING_TRACE, dir: string) {
        const videoBase = await this.traceStorage!.getCaptureDir(loc, 'video');
        let video: object;
        try {
            const file = await storage.readdir(videoBase)[0];
            const src = this.publishStorage!.pathed(await this.publishStorage!.getCaptureDir(loc, 'video') + `/${file}`, dir);
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
    async getOutput(content: object, { title = 'Haibun-Review', prettyPrint = true, base = '' }) {
        const forHTML: any = {
            html: {
                "@xmlns": "http://www.w3.org/1999/xhtml",
                head: {
                    meta: {
                        '@charset': 'utf-8'
                    },
                    style: AllCSS
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
        if (base) {
            forHTML.html.head.base = {
                '@href': base
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
            return {
                details: {
                    ul: {
                        li: (headersContent as any).map((i: any) => ({ '#': `${i.name}: ${i.value}` })),
                    },
                    summary
                }
            }
        });
        return ret;
    }
    finish(html: string) {
        html = html.replace('{{SCRIPT}}', ReviewScript);
        return `<!DOCTYPE html>
\n${html}`;
    }
}

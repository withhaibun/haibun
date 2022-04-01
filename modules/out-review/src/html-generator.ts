import { EOL } from "os";
import { create } from "xmlbuilder2";

import { CAPTURE, TActionResultTopics, TTrace, } from "@haibun/core/build/lib/defs";
import { AStorage } from "@haibun/domain-storage/build/AStorage";
import { AllCSS, ReviewScript, StepCircleCSS } from "./assets";
import { EMediaTypes } from "@haibun/domain-storage";

export type TWtw = {
    missing?: string, videoSrc?: string, path: string, ok: boolean,
    seq: number, in: string, name: string, topics?: TActionResultTopics, traces: TTrace[], start: number,
    subResults: TWtw[]
}

export type TINDEX_SUMMARY = {
    ok: boolean,
    path: string,
    title: string
}
const GREEN_CHECK = '✔️';
const RED_CHECK = '❌';

const led = (ok: boolean) => ok ? GREEN_CHECK : RED_CHECK;

export default class HtmlGenerator {
    publishStorage: AStorage;
    uriArgs: string | undefined;
    constructor(publishStorage: AStorage, uriArgs = '') {
        this.publishStorage = publishStorage;
        this.uriArgs = uriArgs;
    }

    linkFor(what: string) {
        return `index_${what}`;
    }

    getIndexSummary(results: { ok: boolean, dir: string, link: string, index: TINDEX_SUMMARY[] }[]) {
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
            const destPath = this.publishStorage!.pathed(EMediaTypes.html, path, `./${CAPTURE}`);

            index.ul.li.push({
                a: {
                    '@href': `${destPath}${this.uriArgs}`,
                    '#': `${led(ok)} ${title}`
                }
            });
        }
        return index;
    }
    getVideo(videoSrc: string) {
        return {
            div: {
                '@id': 'videoDiv',
                '@style': 'width: 640; height: 480; position: fixed; top: 0; right: 0; background-color: black; border: 4px dotted black',
                video: {
                    '@controls': true,
                    '@height': 480,
                    '@width': 640,
                    '@autoplay': true,
                    '@id': 'video',
                    source: {
                        '@type': 'video/webm',
                        '@src': `${videoSrc}${this.uriArgs}`,
                    }
                }
            }
        }
    }

    getFeatureResult(i: TWtw) {
        const html = this.getAFeatureResult(i);
        return {
            ...html,
            script: {
                '@type': 'text/javascript',
                '#': '{{SCRIPT}}'
            },

        }
    }

    getAFeatureResult(i: TWtw) {
        const { videoSrc, path, ok,
            seq, in: inStruction, name, topics, traces, start,
            missing, subResults } = i;
        const video = videoSrc ? this.getVideo(videoSrc) : {}; //{ h1: { '#': 'Video not available' } };
        const heading = path ? {
            h1: {
                '#': path
            }
        } : {};
        const forHTML = {
            ...heading,
            ...video,
            section: {
                '@style': 'padding-top: 480',
                div: <any>[],
                section: {}
            },
        }

        const feature = {
            div: {
                // '@style': 'border-top: 1px dotted grey',
                // a: {
                //     '#': `Result: ${led(ok)}`,
                // },
                div: <any>[],
                section: {
                    div: <any>[]
                }

            }
        }

        if (missing) {
            feature.div.div.push({
                h1: {
                    '#': missing
                }
            })
        } else {
            const o = {
                // '@style': 'padding-top: 1em',
                a: {
                    '@data-time': start,
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
                traces && {
                    '#': this.traces(traces),
                    summary: {
                        '#': `${traces.length} traces`
                    },
                },
                ]
            }
            feature.div.div.push(o);

            for (const s of subResults || []) {
                feature.div.section.div.push({ div: { '@style': 'margin: 0px; margin-left: 80px; /*background-color: pink*/', ...this.getAFeatureResult(s) } });
            }
        }

        forHTML.section.div.push(feature);
        return forHTML;
    }

    async getHtmlDocument(content: object, { title = 'Haibun-Review', prettyPrint = true, base = '' }) {
        const forHTML = {
            html: {
                "@xmlns": "http://www.w3.org/1999/xhtml",
                head: <any>{
                    meta: {
                        '@charset': 'utf-8'
                    },
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
                style: AllCSS,
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
    traces(traces: TTrace[]) {
        const byUrl = traces.map((i) => ({ url: i.response.url, since: i.response.since, headersContent: i.response.trace.headersContent }));

        const ret = byUrl.map(({ url, since, headersContent }) => {
            const summary = {
                a: {
                    '@id': since,
                    '@data-time': since,
                    '@onclick': `setVideoTime(${since})`,
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

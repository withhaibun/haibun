import { EOL } from "os";
import { create } from "xmlbuilder2";

import { TActionResultTopics, TTrace } from "@haibun/core/build/lib/defs";
import { AStorage } from "@haibun/domain-storage/build/AStorage";
import { AllCSS, ReviewScript } from "./assets";
import { stepResult } from "./components/stepResult";
import { featureSummary } from "./components/featureSummary";

export type TSummaryItem = TFeatureSummary | TStepSummary;

type THTMLFragment = any;
export type TFeatureSummary = { missing: string, videoSrc?: string, path: string, title: string, startTime: Date, ok: boolean } & TSubResults;
export type TStepSummary = { seq: number, in: string, name: string, topics?: TActionResultTopics, traces: TTrace[], start: number, ok: boolean } & TSubResults;
type TSubResults = { subResults: TSummaryItem[] }

export type TIndexSummary = {
    ok: boolean,
    path: string,
    title: string,
    startTime: Date
}

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

    getFeatureResult(i: TSummaryItem) {
        const html = this.getASummary(i);
        return {
            ...html,
            script: {
                '@type': 'text/javascript',
                '#': '{{SCRIPT}}'
            },

        }
    }

    isFeature(i: TSummaryItem): i is TFeatureSummary {
        return !!(i as TFeatureSummary).path;
    }

    // returns a feature or step depending on type
    getASummary(i: TSummaryItem): THTMLFragment {
        const comp = this.isFeature(i) ? featureSummary(i, this.uriArgs) : stepResult(i);
        for (const s of i.subResults || []) {
            comp.section.div[0].div.section.div.push({
                div: {
                    '@style': 'margin: 0px; margin-left: 80px; /*background-color: pink*/',
                    ...this.getASummary(s)
                }
            });
        }
        return comp;
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
    finish(html: string) {
        html = html.replace('{{SCRIPT}}', ReviewScript);
        return `<!DOCTYPE html>
\n${html}`;
    }
}

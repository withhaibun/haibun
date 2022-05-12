import { EOL } from "os";
import { create } from "xmlbuilder2";

import { TActionResultTopics, TTrace } from "@haibun/core/build/lib/defs";
import { AllCSS, ReviewCSS, ReviewScript } from "./assets";
import { stepResult } from "./components/stepResult";
import { sourceSummary } from "./components/sourceSummary";
import { featureHeader } from "./components/featureHeader";

export type TSummaryItem = TFeatureSummary | TStepSummary;

type THTMLFragment = any;
export type TFeatureSummary = { missing?: string, videoSrc?: string, sourcePath: string, title: string, startTime: Date, ok: boolean } & TSubResults;
export type TStepSummary = { seq: number, in: string, name: string, topics?: TActionResultTopics, traces: TTrace[], start: number, ok: boolean, sourcePath: string } & TSubResults;
type TSubResults = { subResults: TStepSummary[] }

export type TIndexSummary = {
    ok: boolean,
    sourcePath: string,
    title: string,
    startTime?: Date
}

export default class HtmlGenerator {
    uriArgs: string | undefined;
    constructor(uriArgs = '') {
        this.uriArgs = uriArgs;
    }

    linkFor(what: string) {
        return `index_${what}`;
    }

    getFeatureResult(i: TFeatureSummary, title: string) {
        const header = featureHeader(i, this.uriArgs);
        const steps = this.getSteps(i.subResults, i.sourcePath);

        return {
            div: [header, steps],
            style: {
                '#': ReviewCSS
            },
            script: {
                '@type': 'text/javascript',
                '#': '{{SCRIPT}}'
            }
        }
    }

    isFeature(i: TSummaryItem): i is TFeatureSummary {
        return !!(i as TFeatureSummary).title;
    }

    getSteps(stepResults: TStepSummary[], origin: string): THTMLFragment {
        const allSteps: any = [];
        let curStart: TStepSummary | undefined = undefined;
        let wrapper: any | undefined = undefined;
        for (const step of stepResults) {
            const { sourcePath } = step;
            if (sourcePath !== curStart?.sourcePath) {
                if (wrapper !== undefined) {
                    allSteps.push(wrapper);
                }
                curStart = step;
                wrapper = {
                    details: {
                        '@style': `padding-left: ${origin === sourcePath ? 40 : 60}px`,
                        '@open': true,
                        summary: {
                            '#': sourceSummary(step),
                        },
                        span: {
                            '@class': 'step-current',
                            '@id': `current-${curStart.start}`
                        }
                        ,
                        div: []
                    }
                }
            }
            const comp = stepResult(step, curStart.start);
            wrapper.details.div.push(comp);
        }
        allSteps.push(wrapper);
        return allSteps;
    }

    async getHtmlDocument(content: object, { title = 'Haibun-Review', prettyPrint = true, base = '' }) {
        const forHTML = {
            html: {
                "@xmlns": "http://www.w3.org/1999/xhtml",
                head: <any>{
                    meta: {
                        '@charset': 'utf-8'
                    },
                    style: AllCSS,
                    title,
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
                },
                body: {
                    ...content,
                }
            }
        }
        if (base) {
            forHTML.html.head.base = {
                '@href': base
            }
        }

        const created = create(forHTML).end({ prettyPrint, newline: EOL });
        const html = this.finish(created);
        return html;
    }
    finish(html: string) {
        html = html.replace('{{SCRIPT}}', ReviewScript);
        return `<!DOCTYPE html>\n\n${html}`;
    }
}

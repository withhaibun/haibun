import { friendlyTime } from "@haibun/core/build/lib/util";
import { TFeatureSummary } from "../html-generator";
import { fixedVideo } from "./fixedVideo";
import { led } from "./led";

export const featureSummary = (i: TFeatureSummary, uriArgs: string | undefined) => {
    const { videoSrc, path, ok, missing, title, startTime } = i;
    const video = videoSrc ? fixedVideo(videoSrc, uriArgs) : {};
    const forHTML = {
        h1: {
            '@style': 'position: fixed; top: 0; left: 0; padding: 18px; margin: 0px; background-color: rgba(255,255,255,0.85); ',
            '#': `${led(ok)} ${title}`
        },
        p: {
            '@style': 'padding-top: 5em',
            span: {
                '@style': 'display: inline-block; width: 2.3em;',
                '#': ' '
            },
            '#': `${path} ${friendlyTime(startTime)}`,
        },
        ...video,
        section: {
            '@style': 'padding-top: 480',
            div: <any>[],
        }
    }

    const feature = {
        div: {
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
    }

    forHTML.section.div.push(feature);
    return forHTML;
}
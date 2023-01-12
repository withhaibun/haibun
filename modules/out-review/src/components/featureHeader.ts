import { TFeatureSummary } from "../html-generator.js";
import { fixedVideo } from "./fixedVideo.js";
import { led } from "./led.js";

export const featureHeader = (i: TFeatureSummary, featureTitle: string, uriArgs: string | undefined) => {
    const { videoSrc, ok, missing, title } = i;
    
    const video = videoSrc ? fixedVideo(videoSrc, uriArgs) : {};
    const forHTML = {
        '@class': 'review-header',
        h1: {
            '@class': 'review-header-fixed',
            '#': `${led(ok)} ${title} > ${featureTitle}`
        },
        div: <any>{},
        ...video,
    }


    if (missing) {
        forHTML.div.h1 = {
            '#': missing
        }
    }

    return forHTML;
}
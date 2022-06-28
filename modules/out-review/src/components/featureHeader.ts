import { TFeatureSummary } from "../html-generator";
import { fixedVideo } from "./fixedVideo";
import { led } from "./led";

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

export const fixedVideo = (videoSrc: string, uriArgs: string | undefined) => {
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
                    '@src': `${videoSrc}${uriArgs}`,
                }
            }
        }
    }
}

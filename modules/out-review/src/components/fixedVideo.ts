
export const fixedVideo = (videoSrc: string, uriArgs: string | undefined) => {
    return {
        div: {
            '@id': 'videoDiv',
            '@style': 'width: 40%; position: fixed; top: 0; right: 0; background-color: black; border: 4px dotted black',
            video: {
                '@controls': true,
                '@height': '100%',
                '@padding-bottom':'56.25%',
                '@width': '100%%',
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

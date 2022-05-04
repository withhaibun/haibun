import { TTrace } from "@haibun/core/build/lib/defs";

export const traces = (traces: TTrace[], start: number) => {
    const byUrl = traces.map((i) => ({ url: i.response.url, since: i.response.since, headersContent: i.response.trace.headersContent }));

    const ret = byUrl.map(({ url, since, headersContent }) => {
        const summary = {
            a: {
                '@id': `i${since}`,
                '@data-start': start,
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
import { css } from 'lit';
import { TFoundHistories } from '@haibun/out-review/build/lib.js';

export const globalStyles = css`
    a {
      text-decoration: none;
    }
    a :hover {
      text-decoration: underline;
    }
    h1 a {
      font-size: 80%;
    }
  `;

export type TStep = { '@type': string, description: string, result: boolean, report?: { html: string, type: string } };
export type TReview = {
    overview: { title: string, when: string, video: string, ok: true | false },
    steps: TStep[]
};

export type TRetrievedReviews = {
    [source: string]: TReview[]
}

export const reviewsLD: TFoundHistories = {
    "meta": {
        "date": 1697126156385,
        "ok": 1,
        "fail": 1
    },
    "histories": {
        "capture/default/__test/loop-1/seq-0/featn-1/mem-0/tracks/tracks.json": {
            "meta": {
                "startTime": "2023-10-12T15:55:54.887Z",
                "title": "local a11y",
                "startOffset": 0.25108754,
                "ok": false
            },
            "logHistory": [
                {
                    "messageContext": {
                        "tag": {
                            "key": "__test",
                            "sequence": 0,
                            "loop": 1,
                            "member": 0,
                            "featureNum": 1,
                            "params": {
                                "test": "http://localhost:8123/a11y.html",
                                "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
                                "_scored": [],
                                "feature": "Test accessibility"
                            },
                            "trace": true
                        }
                    },
                    "message": "features: 2 backgrounds: 7 steps: (/features/a11y-fail.feature,/features/a11y-pass.feature), 2",
                    "level": "log",
                    "caller": "run:67:18"
                },
            ]
        }
    }
};

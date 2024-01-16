import { TArtifact } from "@haibun/core/build/lib/interfaces/logger.js";

export const testLogMessage = (artifact: TArtifact) => ({
    "$schema": "https://raw.githubusercontent.com/withhaibun/schemas/main/schemas/FoundHistories.json#1.33.0",
    "meta": {
        "date": 1705093472838,
        "ok": 1,
        "fail": 0
    },
    "histories": {
        "capture/default/__test/loop-1/seq-0/featn-1/mem-0/tracks/tracks.json": {
            $schema: "https://raw.githubusercontent.com/withhaibun/schemas/main/schemas/HistoryWithMeta.json#1.33.0",
            meta: {
                startTime: "2024-01-12T21:04:31.524Z",
                description: "local a11y-pass",
                feature: "Test accessibility pass",
                startOffset: 0.347126454,
                ok: true
            },
            logHistory: [{
                messageContext: {
                    "topic": {
                        "stage": "action",
                        "event": "debug"
                    },
                    artifact,
                    tag: {
                        "key": "__test",
                        "sequence": 0,
                        "loop": 1,
                        "member": 0,
                        "featureNum": 1,
                        "params": {
                            "test": "http://localhost:8123/a11y.html",
                            "_scored": [],
                            "feature": "Test accessibility pass",
                            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html"
                        },
                        "trace": true
                    },

                },
                message: "playwright request about:blank -> http://localhost:8123/a11y.html",
                level: "debug",
                caller: "PlaywrightEvents:84:21"
            }
            ]
        }
    }
});

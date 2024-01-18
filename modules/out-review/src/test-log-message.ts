import { TRACKS_FILE } from "@haibun/core/build/lib/LogHistory.js";
import { TArtifact as TArtifact } from "@haibun/core/build/lib/interfaces/logger.js";

export const testFoundHistory = (date: number, artifacts: TArtifact[]) => ({
    "$schema": "https://raw.githubusercontent.com/withhaibun/schemas/main/schemas/FoundHistories.json#1.33.0",
    "meta": {
        date,
        "ok": 1,
        "fail": 0
    },
    "histories": {
        [`capture/default/__test/loop-1/seq-0/featn-1/mem-0/tracks/${TRACKS_FILE}`]: testHistoryWithMeta(artifacts),
    }
});

export function testLogHistory(artifacts: TArtifact[]) {
    return artifacts.map(artifact => ({
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
                "params": {},
                "trace": true
            },

        },
        message: "playwright request about:blank -> http://localhost:8123/a11y.html",
        level: "debug",
        caller: "PlaywrightEvents:84:21"
    }));
}

export function testHistoryWithMeta(artifacts: TArtifact[]) {
    return {
        $schema: "https://raw.githubusercontent.com/withhaibun/schemas/main/schemas/HistoryWithMeta.json#1.33.0",
        meta: {
            startTime: "2024-01-12T21:04:31.524Z",
            description: "local a11y-pass",
            feature: "Test accessibility pass",
            startOffset: 0.347126454,
            ok: true
        },
        logHistory: testLogHistory(artifacts)
    }
}
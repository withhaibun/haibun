import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import OutReviews, { DASHBOARD_ROOT, REVIEWS_STORAGE, REVIEW_FILE, TRACKS_STORAGE } from './out-reviews-stepper.js';
import DomainStorage from '@haibun/domain-storage/build/domain-storage.js'
import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import StorageFS from '@haibun/storage-fs/build/storage-fs.js';
import StorageMem from '@haibun/storage-mem/build/storage-mem.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { Timer } from '@haibun/core/build/lib/Timer.js';

const track = JSON.stringify({
    "meta": {
        "startTime": "2023-06-21T16:38:17.308Z",
        "title": "tests",
        "startOffset": 0.241035356
    },
    "result": {
        "path": "/features/auth/login.feature",
        "ok": true,
        "stepResults": [
            {
                "ok": true,
                "in": "Feature: Login",
                "sourcePath": "/features/auth/login.feature",
                "actionResults": [
                    {
                        "ok": true,
                        "name": "feature",
                        "start": 0.242762342,
                        "end": 0.242810572
                    }
                ],
                "seq": 1
            },
            {
                "ok": true,
                "in": "Set username input to //*[@id=\"id_auth- username\"]",
                "sourcePath": "/backgrounds/auth/login.feature",
                "actionResults": [
                    {
                        "ok": true,
                        "name": "set",
                        "start": 0.243154221,
                        "end": 0.243194381
                    }
                ],
                "seq": 2
            }
        ]
    }
});
const TEST_CAPTURES = {
    './capture/default': ['123', '456'],
    './capture/default/123': ['loop-0'],
    './capture/default/123/loop-0': ['seq-0'],
    './capture/default/123/loop-0/seq-0': ['featn-0'],
    './capture/default/123/loop-0/seq-0/featn-0': ['mem-0'],
    './capture/default/123/loop-0/seq-0/featn-0/mem-0': ['tracks'],
    './capture/default/123/loop-0/seq-0/featn-0/mem-0/tracks': ['tracks.json'],
    './capture/default/123/loop-0/seq-0/featn-0/mem-0/tracks/tracks.json': track,
    './capture/default/456': ['loop-0'],
    './capture/default/456/loop-0': ['seq-0'],
    './capture/default/456/loop-0/seq-0': ['featn-0'],
    './capture/default/456/loop-0/seq-0/featn-0': ['mem-0'],
    './capture/default/456/loop-0/seq-0/featn-0/mem-0': ['tracks'],
}

describe('reviews', () => {
    it('Generates reviews', async () => {
        StorageMem.BASE_FS = TEST_CAPTURES;
        const outReviewsStepper = new OutReviews();
        const feature = { path: '/features/test.feature', content: `publish reviews` };
        const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem, StorageFS], {
            options: { DEST: DEFAULT_DEST },
            extraOptions: {
                [getStepperOptionName(outReviewsStepper, TRACKS_STORAGE)]: 'StorageMem',
                [getStepperOptionName(outReviewsStepper, REVIEWS_STORAGE)]: 'StorageMem',
            },
        });
        expect(result.ok).toBe(true);
    });
})

describe('indexes', () => {
    it('Generates index', async () => {
        StorageMem.BASE_FS = TEST_CAPTURES;
        const outReviewsStepper = new OutReviews();
        const feature = { path: '/features/test.feature', content: `create index` };
        const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem, StorageFS], {
            options: { DEST: DEFAULT_DEST },
            extraOptions: {
                [getStepperOptionName(outReviewsStepper, TRACKS_STORAGE)]: 'StorageMem',
                [getStepperOptionName(outReviewsStepper, REVIEWS_STORAGE)]: 'StorageMem',
            },
        });
        expect(result.ok).toBe(true);
    });
})

describe('dashboard', () => {
    StorageMem.BASE_FS = {};
    it('Generates dashboard', async () => {
        const outReviewsStepper = new OutReviews();
        const feature = { path: '/features/test.feature', content: `create dashboard page` };
        const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem, StorageFS], {
            options: { DEST: DEFAULT_DEST },
            extraOptions: {
                [getStepperOptionName(outReviewsStepper, TRACKS_STORAGE)]: 'StorageMem',
                [getStepperOptionName(outReviewsStepper, REVIEWS_STORAGE)]: 'StorageMem',
                [getStepperOptionName(outReviewsStepper, DASHBOARD_ROOT)]: '/test',
            },
        });
        expect(result.ok).toBe(true);
        const tree = result.featureResults[0].stepResults[0].actionResults[0].topics.tree;
        expect(tree.details.filter(d => d.name === '/test/index.html')).toHaveLength(1);
        expect(tree.details.filter(d => d.name === '/test/lib')).toHaveLength(1);
        expect(tree.details.filter(d => d.name === '/test/node_modules')).toHaveLength(0);
    });

    it('Generates dashboard review links', async () => {
        StorageMem.BASE_FS = {
            [`./capture/${REVIEW_FILE}`]: JSON.stringify({ published: 'miaow' })
        };
        const outReviewsStepper = new OutReviews();
        const feature = { path: '/features/test.feature', content: `publish dashboard review link` };
        const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem, StorageFS], {
            options: { DEST: DEFAULT_DEST },
            extraOptions: {
                [getStepperOptionName(outReviewsStepper, TRACKS_STORAGE)]: 'StorageMem',
                [getStepperOptionName(outReviewsStepper, REVIEWS_STORAGE)]: 'StorageMem',
                [getStepperOptionName(outReviewsStepper, DASHBOARD_ROOT)]: '/test',
            },
        });
        expect(result.ok).toBe(true);
        const tree = result.featureResults[0].stepResults[0].actionResults[0].topics.tree;
        expect(tree.details[0].name).toBe(`/test/reviews/${Timer.key}.json`);
    });
});


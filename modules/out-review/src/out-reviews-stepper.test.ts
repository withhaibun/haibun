import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import OutReviews, { REVIEWS_STORAGE, TRACKS_STORAGE } from './out-reviews-stepper.js';
import DomainStorage from '@haibun/domain-storage/build/domain-storage.js'
import StorageMem from '@haibun/storage-mem/build/storage-mem.js';
import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import StorageFS from '@haibun/storage-fs/build/storage-fs.js';

describe('out-review', () => {
    const DEST = './capture/default/loop-0/seq-0/featn-0/mem-0/test/mark.flag';
    const CONTENT = 'eh';
    StorageMem.BASE_FS = {
        './capture/default': ['loop-0'],
        './capture/default/loop-0': ['seq-0'],
        './capture/default/loop-0/seq-0': ['featn-0'],
        './capture/default/loop-0/seq-0/featn-0': ['mem-0'],
        './capture/default/loop-0/seq-0/featn-0/mem-0': ['test'],
        './capture/default/loop-0/seq-0/featn-0/mem-0/test': ['test.feature'],
        [DEST]: CONTENT,
    };
    describe('Generate reviews', () => {
        it('Generates reviews', async () => {

            const outReviewsStepper = new OutReviews();
            const feature = { path: '/features/test.feature', content: `publish results` };
            const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem, StorageFS], {
                options: { DEST: DEFAULT_DEST },
                extraOptions: {
                    [getStepperOptionName(outReviewsStepper, TRACKS_STORAGE)]: 'StorageMem',
                    [getStepperOptionName(outReviewsStepper, REVIEWS_STORAGE)]: 'StorageMem',
                },
            });
            expect(result.ok).toBe(true);
        });
    });
})

describe.only('dashboard', () => {
    StorageMem.BASE_FS = {};
    describe('Generate dashboard', () => {
        it('Generates dashboard', async () => {
            const outReviewsStepper = new OutReviews();
            const feature = { path: '/features/test.feature', content: `create dashboard page` };
            const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem, StorageFS], {
                options: { DEST: DEFAULT_DEST },
                extraOptions: {
                    [getStepperOptionName(outReviewsStepper, TRACKS_STORAGE)]: 'StorageMem',
                    [getStepperOptionName(outReviewsStepper, REVIEWS_STORAGE)]: 'StorageMem',
                },
            });
            expect(result.ok).toBe(true);
            const tree = result.featureResults[0].stepResults[0].actionResults[0].topics.tree;
            expect(tree.details.filter(d => d.name === '/dashboard/index.html')).toHaveLength(1);
            expect(tree.details.filter(d => d.name === '/dashboard/lib')).toHaveLength(1);
        });
    });
});
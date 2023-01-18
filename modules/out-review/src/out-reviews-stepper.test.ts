import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import OutReviews, { TRACKS_STORAGE } from './out-reviews-stepper.js';
import DomainStorage from '@haibun/domain-storage/build/domain-storage.js'
import StorageFS from '@haibun/storage-fs/build/storage-fs.js';
import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';

describe('out-review', () => {
    describe.skip('Generate reviews', () => {
        it('Generates reviews', async () => {
            const outReviewsStepper = new OutReviews();
            const feature = { path: '/features/test.feature', content: `publish reviews` };
            const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageFS], {
                options: { DEST: DEFAULT_DEST },
                extraOptions: {
                    [getStepperOptionName(outReviewsStepper, TRACKS_STORAGE)]: 'StorageFS',
                },
            });
            expect(result.ok).toBe(true);
        });
    });
})

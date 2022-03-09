import { testWithDefaults } from '@haibun/core/build/lib/test/lib';
import OutReviews from './out-reviews-stepper';
import DomainStorage from '@haibun/domain-storage'
import StorageFS from '@haibun/storage-fs';
import { getStepperOptionName } from '@haibun/core/build/lib/util';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs';

describe('out-review', () => {
    describe('Generate reviews', () => {
        it('Generates reviews', async () => {
            const outReviewsStepper = new OutReviews();
            const feature = { path: '/features/test.feature', content: `publish reviews` };
            const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageFS], {
                options: { DEST: DEFAULT_DEST },
                extraOptions: {
                    [getStepperOptionName(outReviewsStepper, 'IN_STORAGE')]: 'StorageFS',
                    [getStepperOptionName(outReviewsStepper, 'OUT_STORAGE')]: 'StorageFS',
                },
            });
            console.log('🤑', JSON.stringify(result, null, 2));
            expect(result.ok).toBe(true);
        });
    });
})

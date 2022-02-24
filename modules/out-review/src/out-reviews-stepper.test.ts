import { testWithDefaults } from '@haibun/core/build/lib/test/lib';
import OutReviewsStepper from './out-reviews-stepper';
import DomainStorage from '@haibun/domain-storage';
import StorageFS from '@haibun/storage-fs';
import { getStepperOptionName } from '@haibun/core/build/lib/util';

describe('out-review', () => {
    describe('Generate reviews', () => {
        it('Generates reviews', async () => {
            const outReviewsStepper = new OutReviewsStepper();
            const feature = { path: '/features/test.feature', content: `publish reviews` };
            const { result } = await testWithDefaults([feature], [OutReviewsStepper, DomainStorage, StorageFS], {
                options: {},
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
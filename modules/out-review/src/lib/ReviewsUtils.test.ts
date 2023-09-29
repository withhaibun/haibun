import StorageMem from '@haibun/storage-mem/build/storage-mem.js';
import { ReviewsUtils } from './ReviewsUtils.js';
import Logger, { LOGGER_NOTHING } from "@haibun/core/build/lib/Logger.js";

const TEST_CAPTURES = {
    './capture/default': ['123', '456'],
    './capture/default/123': ['loop-0'],
    './capture/default/123/loop-0': ['seq-0'],
    './capture/default/123/loop-0/seq-0': ['featn-0'],
    './capture/default/123/loop-0/seq-0/featn-0': ['mem-0'],
    './capture/default/123/loop-0/seq-0/featn-0/mem-0': ['tracks'],
    './capture/default/123/loop-0/seq-0/featn-0/mem-0/tracks': ['tracks.json'],
    './capture/default/456': ['loop-0'],
    './capture/default/456/loop-0': ['seq-0'],
    './capture/default/456/loop-0/seq-0': ['featn-0'],
    './capture/default/456/loop-0/seq-0/featn-0': ['mem-0'],
    './capture/default/456/loop-0/seq-0/featn-0/mem-0': ['tracks'],
}

describe('ReviewsUtils', () => {
    it('gets member entries', async () => {
        StorageMem.BASE_FS = TEST_CAPTURES;
        const trackStorage = new StorageMem();
        const logger = new Logger(LOGGER_NOTHING);
        const reviewsUtils = new ReviewsUtils(logger, trackStorage, trackStorage, trackStorage, trackStorage);
        const res = await reviewsUtils.getMemberEntries('default');
        expect(res).toEqual([
            {
                memDir: "./capture/default/123/loop-0/seq-0/featn-0/mem-0",
                tag: { featureNum: 0, loop: 0, member: 0, params: {}, sequence: 0, trace: false, key: '123' }
            },
            {
                memDir: "./capture/default/456/loop-0/seq-0/featn-0/mem-0",
                tag: { featureNum: 0, loop: 0, member: 0, params: {}, sequence: 0, trace: false, key: '456' }
            }
        ]);
    });
});

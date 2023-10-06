import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import OutReviews, { STORAGE } from './new-out-reviews-stepper.js';
import DomainStorage from '@haibun/domain-storage/build/domain-storage.js';
import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { CAPTURE, DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import StorageFS from '@haibun/storage-fs/build/storage-fs.js';
import StorageMem from '@haibun/storage-mem/build/storage-mem.js';

const track = JSON.stringify({
  meta: {
    startTime: '2023-06-21T16:38:17.308Z',
    title: 'tests',
    startOffset: 0.241035356,
  },
  result: {
    path: '/features/auth/login.feature',
    ok: true,
    stepResults: [
      {
        ok: true,
        in: 'Feature: Login',
        sourcePath: '/features/auth/login.feature',
        actionResults: [
          {
            ok: true,
            name: 'feature',
            start: 0.242762342,
            end: 0.242810572,
          },
        ],
        seq: 1,
      },
      {
        ok: true,
        in: 'Set username input to //*[@id="id_auth- username"]',
        sourcePath: '/backgrounds/auth/login.feature',
        actionResults: [
          {
            ok: true,
            name: 'set',
            start: 0.243154221,
            end: 0.243194381,
          },
        ],
        seq: 2,
      },
    ],
  },
});
const TEST_CAPTURES = {
  '/capture/default': ['123', '456'],
  '/capture/default/123': ['loop-0'],
  '/capture/default/123/loop-0': ['seq-0'],
  '/capture/default/123/loop-0/seq-0': ['featn-0'],
  '/capture/default/123/loop-0/seq-0/featn-0': ['mem-0'],
  '/capture/default/123/loop-0/seq-0/featn-0/mem-0': ['tracks'],
  '/capture/default/123/loop-0/seq-0/featn-0/mem-0/tracks': ['tracks.json'],
  '/capture/default/123/loop-0/seq-0/featn-0/mem-0/tracks/tracks.json': track,
  '/capture/default/456': ['loop-0'],
  '/capture/default/456/loop-0': ['seq-0'],
  '/capture/default/456/loop-0/seq-0': ['featn-0'],
  '/capture/default/456/loop-0/seq-0/featn-0': ['mem-0'],
  '/capture/default/456/loop-0/seq-0/featn-0/mem-0': ['tracks'],
};

describe('findTracksJson', () => {
  it('finds tracks', async () => {
    StorageMem.BASE_FS = TEST_CAPTURES;
    const outReviews = new OutReviews();
    outReviews.tracksStorage = new StorageMem();
    const traces = await outReviews.findTracksJson(`/${CAPTURE}`);
    expect(traces).toBeDefined();
    expect(Object.keys(traces).length).toBe(1);
  });
});

describe('findHistory', () => {
  it('finds logHistory', async () => {
    StorageMem.BASE_FS = TEST_CAPTURES;
    const outReviews = new OutReviews();
    outReviews.tracksStorage = new StorageMem();
    const tracksHistory = await outReviews.findTracks();
    expect(tracksHistory).toBeDefined();
    expect(tracksHistory).toEqual({ '/capture/default/123/loop-0/seq-0/featn-0/mem-0/tracks/tracks.json': JSON.parse(track) });
  });
});

describe.only('reviews', () => {
  it('create found reviews', async () => {
    StorageMem.BASE_FS = TEST_CAPTURES;
    const outReviewsStepper = new OutReviews();
    const feature = { path: '/features/test.feature', content: `create found reviews` };
    const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem, StorageFS], {
      options: { DEST: DEFAULT_DEST },
      extraOptions: {
        [getStepperOptionName(outReviewsStepper, STORAGE)]: 'StorageMem',
      },
    });
    console.log('🤑', JSON.stringify(result.failure, null, 2));
    expect(result.ok).toBe(true);
  });
});

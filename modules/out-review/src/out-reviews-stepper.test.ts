import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import SetTimeStepper from '@haibun/core/build/lib/test/SetTimeStepper.js';
import OutReviews, { PUBLISH_ROOT, STORAGE, publishedPath } from './out-reviews-stepper.js';
import DomainStorage from '@haibun/domain-storage/build/domain-storage.js';
import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { CAPTURE, DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import StorageFS from '@haibun/storage-fs/build/storage-fs.js';
import StorageMem from '@haibun/storage-mem/build/storage-mem.js';

const track = {
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
};

const TEST_CAPTURES = {
  [`${CAPTURE}/default/123/loop-0/seq-0/featn-0/mem-0/tracks/tracks.json`]: JSON.stringify(track),
  [`${CAPTURE}/default/123/loop-0/seq-0/featn-0/mem-1/tracks/tracks.json`]: JSON.stringify({ ...track, meta: { ...track.meta, startTime: '2023-06-21T16:38:17.308Z' } }),
};

describe.skip('findTracksJson', () => {
  it('finds tracks', async () => {
    StorageMem.BASE_FS = TEST_CAPTURES;
    const outReviews = new OutReviews();
    outReviews.publishStorage = new StorageMem();
    const traces = await outReviews.findTracksJson(`/${CAPTURE}`);
    expect(traces).toBeDefined();
    expect(Object.keys(traces).length).toBe(1);
  });
});

describe.skip('findHistory', () => {
  it('finds logHistory', async () => {
    StorageMem.BASE_FS = TEST_CAPTURES;
    const outReviews = new OutReviews();
    outReviews.publishStorage = new StorageMem();
    const tracksHistory = await outReviews.transformTracksAndArtifacts(CAPTURE);
    expect(tracksHistory).toBeDefined();
    expect(tracksHistory).toEqual({ [`/capture/default/123/loop-0/seq-0/featn-0/mem-0/tracks/tracks.json`]: track });
  });
});

describe.skip('found history', () => {
  it('create found history', async () => {
    StorageMem.BASE_FS = TEST_CAPTURES;
    const feature = { path: '/features/test.feature', content: `create found history` };
    const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem, StorageFS], {
      options: { DEST: DEFAULT_DEST },
      extraOptions: {
        [getStepperOptionName(OutReviews, STORAGE)]: 'StorageMem',
      },
    });
    console.log('🤑', JSON.stringify(result.failure, null, 2));
    expect(result.ok).toBe(true);
  });
});

describe('clear files older than', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })
  it('clear files older than 1h', async () => {
    const base = '/published';
    const tracks = `${base}/tracks`;

    const content = `
create directory at ${tracks}
change date to 2024-1-1 13:00:00
create file at ${tracks}/13.txt with "foo"
directory ${tracks} has 1 files
change date to 2024-1-1 14:01:00
create file at ${tracks}/14.txt with "bar"
directory ${tracks} has 2 files
change date to 2024-1-1 15:00:00
clear files older than 1h
directory ${tracks} has 1 files`;
    const feature = { path: '/features/test.feature', content };
    const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem, SetTimeStepper], {
      options: { DEST: DEFAULT_DEST },
      extraOptions: {
        [getStepperOptionName(OutReviews, PUBLISH_ROOT)]: base,
        [getStepperOptionName(OutReviews, STORAGE)]: 'StorageMem'
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe('artifactLocation', () => {
  it('creates artifactLocation', async () => {
    const o = new OutReviews();
    o.publishStorage = new StorageFS();
    const loc = await o.artifactLocation('capture/bar', 'reviews', 'capture');
    expect(loc).toEqual({ pathed: 'reviews/bar' });
  });
});

describe('publishedPath', () => {
  it('finds publishedPath', async () => {
    const o = publishedPath('reviews/tracks/default/video/123.webm', './reviews');
    expect(o).toEqual('./tracks/default/video/123.webm');
  });
});

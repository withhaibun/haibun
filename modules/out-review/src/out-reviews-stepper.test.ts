import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import SetTimeStepper from '@haibun/core/build/lib/test/SetTimeStepper.js';
import OutReviews, { PUBLISH_ROOT, STORAGE, publishedPath } from './out-reviews-stepper.js';
import DomainStorage from '@haibun/domain-storage/build/domain-storage.js';
import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import StorageMem from '@haibun/storage-mem/build/storage-mem.js';
import { testFoundHistory, testHistoryWithMeta } from './test-log-message.js';
import { TArtifact, TLogHistoryWithArtifact } from '@haibun/core/build/lib/interfaces/logger.js';

const CAPTURE = '/capture';
const publishRoot = '/published';
const capturedTracks = `${CAPTURE}/tracks`;
const publishedTracks = `${publishRoot}/tracks`;
const captureArtifact1: TArtifact = { type: 'video', path: `${capturedTracks}/1.webm` }
const captureArtifact2: TArtifact = { type: 'video', path: `${capturedTracks}/2.webm` }

const publishArtifact1: TArtifact = { type: 'video', path: `${publishedTracks}/1.webm` }
const publishArtifact2: TArtifact = { type: 'video', path: `${publishedTracks}/2.webm` }
const publishArtifact3: TArtifact = { type: 'video', path: `${publishedTracks}/3.webm` }

const tracks1 = `${CAPTURE}/default/123/loop-0/seq-0/featn-0/mem-0/tracks/tracks.json`;
const tracks2 = `${CAPTURE}/default/123/loop-0/seq-0/featn-0/mem-1/tracks/tracks.json`;

const TEST_CAPTURES = {
  [tracks1]: JSON.stringify(testHistoryWithMeta(captureArtifact1)),
  [tracks2]: JSON.stringify(testHistoryWithMeta(captureArtifact2))
};

describe('findTracksJson', () => {
  afterEach(() => {
    StorageMem.BASE_FS = undefined;
  });
  it('finds tracks', async () => {
    StorageMem.BASE_FS = TEST_CAPTURES;
    const outReviews = new OutReviews();
    outReviews.tracksStorage = new StorageMem();
    const traces = await outReviews.findTracksJson(CAPTURE);
    expect(traces).toBeDefined();
    expect(Object.keys(traces).length).toBe(2);
  });
});

describe.skip('transform logHistory', () => {
  afterEach(() => {
    StorageMem.BASE_FS = undefined;
  });
  it('transform logHistory', async () => {
    StorageMem.BASE_FS = TEST_CAPTURES;
    const outReviews = new OutReviews();
    outReviews.tracksStorage = new StorageMem();
    outReviews.publishStorage = new StorageMem();
    outReviews.publishRoot = publishRoot;
    const tracksHistory = await outReviews.transformTracksAndArtifacts(CAPTURE);
    expect(tracksHistory).toBeDefined();
    expect((tracksHistory.foundHistories.histories[tracks1].logHistory[0] as unknown as TLogHistoryWithArtifact).messageContext.artifact.path).toBe(`${PUBLISH_ROOT}/`)
  });
});

describe.skip('found history', () => {
  afterEach(() => {
    StorageMem.BASE_FS = undefined;
  });
  it('create found history', async () => {
    StorageMem.BASE_FS = TEST_CAPTURES;
    const feature = { path: '/features/test.feature', content: `create found history` };
    const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem], {
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
list files from ${tracks}
directory ${tracks} has 1 files
change date to 2024-1-1 14:01:00
create file at ${tracks}/14.txt with "bar"
directory ${tracks} has 2 files
change date to 2024-1-1 15:00:00
clear files older than 1h
list files from ${tracks}
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
    o.publishStorage = new StorageMem();
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
describe('clear tracks past', () => {
  afterEach(() => {
    StorageMem.BASE_FS = undefined;
  });
  const foundHistory1 = testFoundHistory(publishArtifact1);
  const foundHistory2 = testFoundHistory(publishArtifact2);
  const foundHistory3 = testFoundHistory(publishArtifact3);
  const artifacted = {
    [`${publishedTracks}/1-tracks.json`]: JSON.stringify(foundHistory1),
    [`${publishedTracks}/1.webm`]: 'reel1',
    [`${publishedTracks}/2-tracks.json`]: JSON.stringify(foundHistory2),
    [`${publishedTracks}/2.webm`]: 'reel2',
    [`${publishedTracks}/3-tracks.json`]: JSON.stringify(foundHistory3),
    [`${publishedTracks}/3.webm`]: 'reel3'
  }
  const setup = `directory ${publishedTracks} has 6 files`;

  it('clears reviews past 1', async () => {
    StorageMem.BASE_FS = artifacted;
    const content = `${setup}
clear reviews past 1
directory ${publishedTracks} has 2 files
`;
    const feature = { path: '/features/test.feature', content };
    const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem, SetTimeStepper], {
      options: { DEST: DEFAULT_DEST },
      extraOptions: {
        [getStepperOptionName(OutReviews, PUBLISH_ROOT)]: publishRoot,
        [getStepperOptionName(OutReviews, STORAGE)]: 'StorageMem'
      },
    });
    expect(result.ok).toBe(true);
  });
  it('clears reviews past 2', async () => {
    StorageMem.BASE_FS = artifacted;
    const content = `${setup}
clear reviews past 2
directory ${publishedTracks} has 4 files
`;
    const feature = { path: '/features/test.feature', content };
    const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem, SetTimeStepper], {
      options: { DEST: DEFAULT_DEST },
      extraOptions: {
        [getStepperOptionName(OutReviews, PUBLISH_ROOT)]: publishRoot,
        [getStepperOptionName(OutReviews, STORAGE)]: 'StorageMem'
      },
    });
    expect(result.ok).toBe(true);
  });
});

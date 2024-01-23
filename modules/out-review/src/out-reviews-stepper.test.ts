import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import SetTimeStepper from '@haibun/core/build/lib/test/SetTimeStepper.js';
import OutReviews, { PUBLISH_ROOT, STORAGE, relativePublishedPath, webPublishedPath } from './out-reviews-stepper.js';
import DomainStorage from '@haibun/domain-storage/build/domain-storage.js';
import { actionNotOK, getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { CAPTURE, DEFAULT_DEST, OK } from '@haibun/core/build/lib/defs.js';
import StorageMem from '@haibun/storage-mem/build/storage-mem.js';
import { testFoundHistory, testHistoryWithMeta } from './test-log-message.js';
import { TArtifact, TLogHistoryWithArtifact } from '@haibun/core/build/lib/interfaces/logger.js';
import { TRACKS_FILE } from '@haibun/core/build/lib/LogHistory.js';

const publishRoot = '/published';
const publishedTracks = `${publishRoot}/tracks`;

const publishArtifact1: TArtifact = { type: 'video', path: `${publishedTracks}/1.webm` }
const publishArtifact1NoPath: TArtifact = { type: 'json/playwright/trace', content: `something` }
const publishArtifact2: TArtifact = { type: 'video', path: `${publishedTracks}/2.webm` }
const publishArtifact22: TArtifact = { type: 'video', path: `${publishedTracks}/22.webm` }
const publishArtifact3: TArtifact = { type: 'video', path: `${publishedTracks}/3.webm` }

const tracks1 = `${CAPTURE}/default/123/loop-0/seq-0/featn-0/mem-0/tracks/${TRACKS_FILE}`;
const tracks2 = `${CAPTURE}/default/123/loop-0/seq-0/featn-0/mem-1/tracks/${TRACKS_FILE}`;

const TEST_CAPTURES = {
  [tracks1]: JSON.stringify(testHistoryWithMeta([])),
  [tracks2]: JSON.stringify(testHistoryWithMeta([]))
};

vi.spyOn(process, 'cwd').mockReturnValue('/');

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

describe('transform logHistory', () => {
  const TEST_CAPTURES = {
    [tracks1]: JSON.stringify(testHistoryWithMeta([{ type: 'video', path: `${CAPTURE}/1.webm` }])),
  };

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
    expect((tracksHistory.foundHistories.histories[tracks1].logHistory[0] as unknown as TLogHistoryWithArtifact).messageContext.artifact.path)
      .toBe(`./tracks/capture/tracks/1.webm`)
  });
});

describe('create found history', () => {
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
    expect(result.ok).toBe(true);
  });
});

describe('create reviews pages', () => {
  afterEach(() => {
    StorageMem.BASE_FS = undefined;
  });
  it('create reviews pages', async () => {
    StorageMem.BASE_FS = TEST_CAPTURES;
    const feature = { path: '/features/test.feature', content: `create reviews pages` };
    const result = await testWithDefaults([feature], [OutReviews, DomainStorage, StorageMem], {
      options: { DEST: DEFAULT_DEST },
      extraOptions: {
        [getStepperOptionName(OutReviews, STORAGE)]: 'StorageMem',
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe('create indexer from tracks', () => {
  afterEach(() => {
    StorageMem.BASE_FS = undefined;
  });
  it('create indexer from tracks', async () => {
    const test = 'indexer contains key';
    class CheckKeyStepper extends OutReviews {
      constructor() {
        super();
        (this as any).steps = {
          ...this.steps, checkKey: {
            exact: test,
            action: async () => {
              const track = await this.publishStorage.readdir(`${publishRoot}/tracks/`);
              const indexer = this.publishStorage.readFile(`${publishRoot}/build/dashboard/indexer.js/`).toString();
              return indexer.includes(track[0]) ? OK : actionNotOK(`indexer does not contain ${track}, it contains ${indexer}`);
            }
          }
        }
      }
    }

    StorageMem.BASE_FS = TEST_CAPTURES;
    const feature = { path: '/features/test.feature', content: `create found history\ncreate reviews pages\ncreate indexer from tracks\n${test}` };
    const result = await testWithDefaults([feature], [DomainStorage, StorageMem, CheckKeyStepper], {
      options: { DEST: DEFAULT_DEST },
      extraOptions: {
        [getStepperOptionName(CheckKeyStepper, STORAGE)]: 'StorageMem',
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

describe('webPublishedPath', () => {
  it('finds absolute webPublishedPath', async () => {
    const p = webPublishedPath('/reviews/tracks/default/video/123.webm', '/reviews');
    expect(p).toEqual('./tracks/default/video/123.webm');
  });
  it('finds relative webPublishedPath', async () => {
    const p = webPublishedPath('reviews/tracks/default/video/123.webm', './reviews');
    expect(p).toEqual('./tracks/default/video/123.webm');
  });
});

describe('relativePublishedPath', () => {
  it('finds relativePublishedPath', async () => {
    const o = relativePublishedPath('./tracks/default/video/123.webm', publishRoot);
    expect(o).toEqual(`${publishRoot}/tracks/default/video/123.webm`);
  });
});
describe('clear tracks past', () => {
  afterEach(() => {
    StorageMem.BASE_FS = undefined;
  });
  const foundHistory1 = testFoundHistory(Date.now(), [publishArtifact1, publishArtifact1NoPath]);
  const foundHistory2TwoArtifacts = testFoundHistory(Date.now() - 10000, [publishArtifact2, publishArtifact22]);
  const foundHistory3OneArtifactOneNoArtifact = testFoundHistory(Date.now() - 20000, [publishArtifact3, undefined]);
  const foundHistory4NoArtifacts = testFoundHistory(Date.now() - 30000, []);

  const setup7 = `directory ${publishedTracks} has 8 files`;

  const artifacted = {
    [`${publishedTracks}/1-${TRACKS_FILE}`]: JSON.stringify(foundHistory1),
    [`${publishedTracks}/1.webm`]: 'reel1',
    [`${publishedTracks}/2-${TRACKS_FILE}`]: JSON.stringify(foundHistory2TwoArtifacts),
    [`${publishedTracks}/2.webm`]: 'reel2',
    [`${publishedTracks}/22.webm`]: 'reel22',
    [`${publishedTracks}/3-${TRACKS_FILE}`]: JSON.stringify(foundHistory3OneArtifactOneNoArtifact),
    [`${publishedTracks}/3.webm`]: 'reel3',
    [`${publishedTracks}/4-${TRACKS_FILE}`]: JSON.stringify(foundHistory4NoArtifacts),
  }
  it('clears reviews past 1', async () => {
    StorageMem.BASE_FS = artifacted;
    const content = `${setup7}
clear reviews past 1
directory ${publishedTracks} has 1 files
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
    const content = `${setup7}
clear reviews past 2
directory ${publishedTracks} has 3 files
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

import { CAPTURE } from '@haibun/core/build/lib/defs.js';
import { getDefaultWorld, getTestWorldWithOptions } from '@haibun/core/build/lib/test/lib.js';
import { EMediaTypes } from '@haibun/domain-storage/build/domain-storage.js';
import StorageFS from './storage-fs.js';
import { Timer } from '@haibun/core/build/lib/Timer.js';

const { key } = Timer;

describe('fs getCaptureLocation', () => {
  it('gets capture location', async () => {
    const storageFS = new StorageFS();
    const { world } = getDefaultWorld(0);
    const dir = await storageFS.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
    expect(dir).toEqual(`./${CAPTURE}/default/${key}/loop-0/seq-0/featn-0/mem-0/test`);
  });
  it('gets options capture location', async () => {
    const storageFS = new StorageFS();
    const world = getTestWorldWithOptions({ options: { DEST: 'foo' }, extraOptions: {} });
    const dir = await storageFS.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
    expect(dir).toEqual(`./${CAPTURE}/foo/${key}/loop-0/seq-0/featn-0/mem-0/test`);
  });
  it('gets relative capture location', async () => {
    const storageFS = new StorageFS();
    const world = getTestWorldWithOptions({ options: { DEST: 'foo' }, extraOptions: {} });
    const dir = await storageFS.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
    expect(dir).toEqual(`./${CAPTURE}/foo/${key}/loop-0/seq-0/featn-0/mem-0/test`);
  });
});

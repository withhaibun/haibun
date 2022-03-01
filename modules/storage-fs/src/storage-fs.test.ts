import { CAPTURE } from '@haibun/core/build/lib/defs';
import { getDefaultWorld } from '@haibun/core/build/lib/test/lib';
import StorageFS from './storage-fs';

describe('getCaptureDir', () => {
    it('gets capture dir', async () => {
        const storageFS = new StorageFS();
        const { world } = getDefaultWorld(0);
        const dir = await storageFS.getCaptureDir(world, 'test');
        expect(dir).toEqual(`./${CAPTURE}/loop-0/seq-0/featn-0/mem-0/test`);
    });
});
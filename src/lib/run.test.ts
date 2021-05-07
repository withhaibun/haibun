import { readFileSync } from 'fs';
import { TSpecl } from './defs';
import { run } from './run';

describe('run self-contained', () => {
    it('includes', async () => {
        const base = process.cwd() + '/test/projects/specl/self-contained';
        const specl: TSpecl = JSON.parse(readFileSync(`${base}/config.json`, 'utf-8'));
        const res = await run(specl, base);
        expect(res.ok).toBe(true);
    });
});

xdescribe('run includes', () => {
    it('includes', async () => {
        const base = '../../test/projects/self-contained';
        const specl: TSpecl = JSON.parse(readFileSync(`${base}/config.json`, 'utf-8'));
        await run(specl, base);
    });
});
import {describe, it, expect} from 'vitest';

import { asFeatures, TEST_BASE } from "./lib.js";

describe('asFeatures', () => {
    it('should add base to path', () => {
        expect(asFeatures([{ path: '/b/c.feature', content: '#' }])).toEqual([{ base: TEST_BASE, path: '/b/c.feature', name: '/b/c', type: 'feature', content: '#' }]);
    });
});
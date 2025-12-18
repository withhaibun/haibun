import {describe, it, expect} from 'vitest';

import { asFeatures } from '../resolver-features.js';
import { TEST_BASE } from '../../schema/protocol.js';

describe('asFeatures', () => {
    it('should add base to path', () => {
        expect(asFeatures([{ path: '/b/c.feature', content: '#' }])).toEqual([{ base: TEST_BASE, path: '/b/c.feature', name: '/b/c', type: 'feature', content: '#' }]);
    });
});

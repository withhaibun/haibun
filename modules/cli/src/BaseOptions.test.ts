import { it, expect, describe } from 'vitest';

import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import { BaseOptions } from './BaseOptions.js';

describe('applyEnvCollections', () => {
  it.skip('creates pairs', () => {
    const p = { DEST: DEFAULT_DEST };
    const res = BaseOptions.options.ENVC.parse('a=1,b=2,a=3,b=4', p);
    expect(res.env).toEqual({
      a: ["1", "3"],
      b: ["2", "4"]
    });
  });
  it('prevents collision', () => {
    const p = { DEST: DEFAULT_DEST, a: 1 };
    const res = BaseOptions.options.ENVC.parse('a=1', p);
    expect(res.error).toBeDefined();
  })
});

describe('apply ENV', () => {
  it('creates env', () => {
    const p = { DEST: DEFAULT_DEST };
    const res = BaseOptions.options.ENV.parse('a=1', p);
    expect(res.error).not.toBeDefined();
    expect(res.env).toEqual({ a: "1" });
  })
  it('prevents collision', () => {
    const p = { DEST: DEFAULT_DEST, a: 1 };
    const res = BaseOptions.options.ENV.parse('a=1', p);
    expect(res.error).toBeDefined();
  })
});
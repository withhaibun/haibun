
import { BaseOptions } from './BaseOptions';

describe('applyEnvCollections', () => {
  it('creates pairs', () => {
    const p = {};
    const res = BaseOptions.options.ENVC.parse('a=1,b=2,a=3,b=4', p);
    expect(res.env).toEqual({
      a: ["1", "3"],
      b: ["2", "4"]
    });
  });
  it('prevents collision', () => {
    const p = { a: 1 };
    const res = BaseOptions.options.ENVC.parse('a=1', p);
    expect(res.error).toBeDefined();
  })
})
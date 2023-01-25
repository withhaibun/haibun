import { spawn } from './index.js';

describe('spawn', () => {
  it('should spawn', () => {
    expect(() => spawn(['echo', 'hello'])).not.toThrow();
  });
  it('should catch failure', () => {
    expect(() => spawn(['xecho', 'hello'])).toThrow();
  });
});
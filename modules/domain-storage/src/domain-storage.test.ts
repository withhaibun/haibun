import { describe, it, expect } from 'vitest';

import { guessMediaExt, guessMediaType } from './domain-storage.js';

describe('guessMediaType', () => {
  it('guessMediaType for js', () => {
    expect(guessMediaType('foo.js')).toEqual('text/javascript');
  });
  it('guessMediaType for unknown', () => {
    expect(guessMediaType('foo.unknown')).toEqual('application/octet-stream');
  });
});

describe('guessMediaExt', () => {
  it('guessMediaExt for js', () => {
    expect(guessMediaExt('foo.js')).toEqual('javascript');
  });
  it('guessMediaExt for unknown', () => {
    expect(guessMediaExt('foo.unknown')).toEqual('unknown');
  });
});

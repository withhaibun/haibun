import { describe, it, expect } from 'vitest';
import { withAction } from './withAction.js';
import { toBdd, fromBdd } from './converter.js';
import { AStepper } from '../lib/astepper.js';
import { OK } from '../lib/defs.js';

// A mock stepper for testing purposes
class TestStepper extends AStepper {
  steps = {
    set: {
      gwta: 'set {what} to {value}',
      action: async () => OK,
    },
    doSomething: {
      gwta: 'do something',
      action: async () => OK,
    },
    registerOutcome: {
      gwta: 'outcome {outcome}',
      action: async () => OK,
    },
    ensure: {
      gwta: 'ensure {outcome}',
      action: async () => OK,
    },
    not: {
        gwta: 'not {statement}',
        action: async () => OK,
    }
  };
}

class ProseStepper extends AStepper {
    steps = {
        prose: {
            gwta: 'prose: {prose}',
            action: async () => OK,
        }
    }
}

class CombinedStepper extends AStepper {
    constructor(steppers: AStepper[]) {
        super();
        this.steps = steppers.reduce((acc, stepper) => ({ ...acc, ...stepper.steps }), {});
    }
}

const stepper = new CombinedStepper([new TestStepper(), new ProseStepper()]);

describe('withAction', () => {
  const { set, doSomething, registerOutcome, ensure, not, prose } = withAction(stepper);

  it('should generate curried functions for each step', () => {
    expect(typeof set).toBe('function');
    expect(typeof doSomething).toBe('function');
    expect(typeof registerOutcome).toBe('function');
    expect(typeof ensure).toBe('function');
    expect(typeof not).toBe('function');
    expect(typeof prose).toBe('function');
  });

  it('should throw an error if a required argument is missing', () => {
    // @ts-expect-error
    expect(() => set({ what: 'sound' })).toThrow('Missing argument "value" for action "set"');
  });

  it('should return an action executor', () => {
    const executor = set({ what: 'sound', value: 'moo' });
    expect(typeof executor).toBe('function');
    const action = executor();
    expect(action.actionName).toBe('set');
    expect(action.args).toEqual({ what: 'sound', value: 'moo' });
    expect(action.gwta).toBe('set sound to moo');
  });

  it('should handle steps with no arguments', () => {
    const executor = doSomething({});
    const action = executor();
    expect(action.actionName).toBe('doSomething');
    expect(action.gwta).toBe('do something');
  });

  it('should handle the "not" step generically', () => {
    const executor = not({ statement: 'ensure an outcome' });
    const action = executor();
    expect(action.actionName).toBe('not');
    expect(action.gwta).toBe('not ensure an outcome');
  });

  it('should handle the "prose" step generically', () => {
    const executor = prose({ prose: 'this is a test' });
    const action = executor();
    expect(action.actionName).toBe('prose');
    expect(action.gwta).toBe('prose: this is a test');
  });

  it('should handle registerOutcome', () => {
    const executor = registerOutcome({ outcome: 'test outcome' });
    const action = executor();
    expect(action.actionName).toBe('registerOutcome');
    expect(action.gwta).toBe('outcome test outcome');
  });

  it('should handle ensure', () => {
    const executor = ensure({ outcome: 'test outcome' });
    const action = executor();
    expect(action.actionName).toBe('ensure');
    expect(action.gwta).toBe('ensure test outcome');
  });
});

describe('toBdd', () => {
  const { set, doSomething } = withAction(stepper);

  it('should convert a jsprolog feature to a BDD string', () => {
    const feature = {
      'my feature': [
        set({ what: 'sound', value: 'moo' }),
        doSomething({}),
      ],
    };
    const expectedBdd = `Feature: my feature
  set sound to moo
  do something
`;
    expect(toBdd(feature)).toBe(expectedBdd);
  });
});

describe('fromBdd', () => {
    it('should convert a BDD string to a jsprolog feature', async () => {
        const bdd = `Feature: my feature
  set sound to moo
  do something
  prose: this is a test
`;
        const feature = await fromBdd(bdd, [stepper]);
        expect(toBdd(feature)).toBe(bdd);
    });
});

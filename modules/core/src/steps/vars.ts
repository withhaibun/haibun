import { Context, DomainContext, WorldContext } from '../lib/contexts';
import { IStepper, IExtensionConstructor, OK, TNamed, TVStep, TWorld } from '../lib/defs';
import { getStepShared } from '../lib/Domain';
import { actionNotOK } from '../lib/util';

const vars: IExtensionConstructor = class Vars implements IStepper {
  world: TWorld;
  constructor(world: TWorld) {
    this.world = world;
  }

  set = async (named: TNamed, vstep: TVStep) => {
    // FIXME hokey
    const emptyOnly = !!vstep.in.match(/set empty /);
    return setShared(named, vstep, this.world, emptyOnly);
  };
  isSet (what: string, orCond: string) {
    if (this.world.shared.get(what) !== undefined) {
      return OK;
    }
    return actionNotOK(`${what} not set ${orCond}`);
  };

  steps = {
    set: {
      gwta: 'set( empty)? {what: string} to {value: string}',
      action: this.set.bind(this),
      build: this.set.bind(this),
    },
    isSet: {
      gwta: '{what: string} is set( or .*)?',
    // FIXME hokey
      action: async({what}: TNamed, vstep: TVStep) => this.isSet(what, vstep.in.replace(/.* set .* or /, '')),
      build: async({what}: TNamed, vstep: TVStep) => this.isSet(what, vstep.in.replace(/.* set .* or /, ''))
    },
    background: {
      match: /^Background: ?(?<background>.+)?$/,
      action: async ({ background }: TNamed) => {
        this.world.shared.set('background', background);
        return OK;
      },
    },
    feature: {
      match: /^Feature: ?(?<feature>.+)?$/,
      action: async ({ feature }: TNamed) => {
        this.world.shared.set('feature', feature);
        return OK;
      },
    },
    scenario: {
      match: /^Scenario: (?<scenario>.+)$/,
      action: async ({ scenario }: TNamed) => {
        this.world.shared.set('scenario', scenario);
        return OK;
      },
    },
    display: {
      gwta: 'display (?<what>.+)',
      action: async ({ what }: TNamed) => {
        this.world.logger.log(`${what} is ${this.world.shared.get(what)}`);

        return OK;
      },
    },
  };
};
export default vars;

export const didNotOverwrite = (what: string, present: string | Context, value: string) => `did not overwrite ${what} value of "${present}" with "${value}"`;

export const setShared = ({ what, value }: TNamed, vstep: TVStep, world: TWorld, emptyOnly: boolean = false) => {
  // if on a domain page, set it in that domain's shared
  const { type, name } = vstep.source;

  let shared = getStepShared(type, world);
  if (shared instanceof DomainContext) {
    const dc = <DomainContext>shared;
    shared = dc.get(name) || dc.createPath(name);
  }

  if (!emptyOnly || shared.get(what) === undefined) {
    shared.set(what, value);
    return OK;
  }

  return { ...OK, details: didNotOverwrite(what, shared.get(what), value) };
};

  export const onType = ({ what, type }: TNamed, world: TWorld) => {
    // verifyDomainObjectExists(what, type);
    world.shared.setDomain(type, what);
    return OK;
  }
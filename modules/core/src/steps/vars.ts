import { Context, DomainContext } from '../lib/contexts';
import { IStepper, IExtensionConstructor, OK, TNamed, TVStep, TWorld, TActionResultTopics } from '../lib/defs';
import { getDomain, getStepShared } from '../lib/domain';
import { actionNotOK } from '../lib/util';

// FIXME hokey
const getOrCond = (fr: string) => fr.replace(/.* is set or /, '');

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
  isSet(what: string, orCond: string) {
    if (this.world.shared.get(what) !== undefined) {
      return OK;
    }
    const [warning, response] = orCond.split(':').map((t) => t.trim());
    const topics: TActionResultTopics = {
      warning: { summary: warning },
    };

    if (response) {
      topics.response = { summary: response };
    }

    return actionNotOK(`${what} not set${orCond && ': ' + orCond}`, { score: 10, topics });
  }

  steps = {
    concat: {
      gwta: 'concat {p1} and {p2} as {what}',
      action: ({ p1, p2, what }: TNamed, vstep: TVStep) => this.set({ what, value: `${p1}${p2}` }, vstep)
    },
    set: {
      gwta: 'set( empty)? {what: string} to {value: string}',
      action: this.set.bind(this),
      build: this.set.bind(this),
    },
    isSet: {
      gwta: '{what: string} is set( or .*)?',

      action: async ({ what }: TNamed, vstep: TVStep) => this.isSet(what, getOrCond(vstep.in)),
      build: async ({ what }: TNamed, vstep: TVStep) => this.isSet(what, getOrCond(vstep.in)),
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
      gwta: 'display {what}',
      action: async ({ what }: TNamed) => {
        this.world.logger.log(`is ${JSON.stringify(what)}`);

        return OK;
      },
    },
  };
};
export default vars;

export const didNotOverwrite = (what: string, present: string | Context, value: string) => ({ overwrite: { summary: `did not overwrite ${what} value of "${present}" with "${value}"` } });

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

  return { ...OK, topics: { ...didNotOverwrite(what, shared.get(what), value) } };
};

// sets the current page for the domain in the world context, gets the location for the name
export const onCurrentTypeForDomain = ({ name, type }: { name: string; type: string }, world: TWorld) => {
  // verifyDomainObjectExists(what, type);
  world.shared.setDomainValues(type, name);
  const domain = getDomain(type, world);
  const page = domain?.shared.get(name);
  if (!page) {
    console.log(
      'using locator',
      domain?.module.domains.map((k) => k.name)
    );

    return domain?.module.locator!(name);
  }
  console.log('using page');
  const uri = page.getID();
  return uri;
};

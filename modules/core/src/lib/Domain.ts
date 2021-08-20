import { Resolver } from '../phases/Resolver';
import { Context, DomainContext } from './contexts';
import { BASE_TYPES, IHasDomains, IStepper, TFileTypeDomain, TFound, TFromDomain, TModuleDomain, TWorld } from './defs';
import { findFeatures } from './features';
import { getNamedToVars } from './namedVars';

export const isBaseType = (type: string) => BASE_TYPES.includes(type);
export const getStepShared = (type: string, world: TWorld): Context => {
  // FIXME  shouldn't need to check 'feature'
  if (type === 'feature' || isBaseType(type)) {
    return world.shared;
  }
  let source = getDomain(type, world);
  if (!source || !source.shared) {
    throw Error(`no shared for ${type}, ${source}}`);
  }
  const isFrom = (<TFromDomain>source).from;

  if (!isFrom) {
    return source.shared;
  }
  const fromSource = getDomain(isFrom, world);
  if (!fromSource || !fromSource.shared) {
    throw Error(`no isFrom shared for ${isFrom}, ${fromSource}}`);
  }
  const current = world.shared.getCurrent(isFrom);

  const currentSource = fromSource.shared.get(current);
  if (!currentSource) {
    throw Error(`no current ${current} shared for ${isFrom}, ${currentSource}}`);
  }
  return currentSource;
};

export const getDomain = (domain: string, world: TWorld) => world.domains.find((d) => d.name === domain);

export const applyStepperDomains = (steppers: IStepper[], world: TWorld) => {
  for (const s of steppers.filter((s) => !!(<IHasDomains>s).domains)) {
    const module = s.constructor.name;
    const domains = (<IHasDomains>s).domains;
    if (domains) {
      for (const d of domains) {
        if (world.domains.find((w) => w.name === d.name)) {
          return { result: { ok: false, failure: { stage: 'Options', error: { details: `duplicate domain ${d.name} at ${module}`, context: world.domains } } } };
        }
        world.domains.push({ ...d, module, shared: new DomainContext(d.name) });
      }
    }
  }
};

// if there is a fileType for the domain type, get it from the match and make sure it is ok
export function checkRequiredType({ path }: { path: string }, featureLine: string, actions: TFound[], world: TWorld) {
  /*
  for (const action of actions) {
    if (action.step.gwta && action.vars) {
      const line = action.step.gwta;
      const domainTypes = action.vars.filter((v) => !isBaseType(v.type));
      if (domainTypes) {
        for (const domainType of domainTypes) {
          const prelude = Resolver.getPrelude(path, line, featureLine);
          let name;
          try {
            const namedWithVars = getNamedToVars(action, world);
            name = namedWithVars![domainType.name];
          } catch (e) {
            console.error('for ', action, e);
            throw Error(`${prelude} ${e}`);
          }
          const fd = world.domains.find((d) => d.name == domainType.type);
          if (fd) {
            const { fileType, backgrounds, validate } = fd as TModuleDomain & TFileTypeDomain;
            if (fileType) {
              const included = findFeatures(name, backgrounds, fileType);

              if (included.length < 1) {
                throw Error(Resolver.getNoFileTypeInclusionError(prelude, fileType, name));
              } else if (included.length > 1) {
                throw Error(Resolver.getMoreThanOneInclusionError(prelude, fileType, name));
              }

              const typeValidationError = validate(included[0].content);
              if (typeValidationError) {
                throw Error(Resolver.getTypeValidationError(prelude, fileType, name, typeValidationError));
              }
            }
          } else {
            throw Error(`${prelude} no domain definition for ${domainType}`);
          }
        }
      }
    }
  }
  */
}

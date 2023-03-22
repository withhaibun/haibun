import { Context, DomainContext } from './contexts.js';
import { BASE_TYPES, AStepper, IHasDomains, IRequireDomains, TFound, TFromDomain, TWorld, TModuleDomain } from './defs.js';

export const isBaseType = (type: string) => BASE_TYPES.includes(type);
export const getStepShared = (type: string, world: TWorld): Context => {
  // FIXME shouldn't need to check 'feature'

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

  /// We are missing the {world: { domain: { page: sharedContext }}}
  /// it has to be created at some point since it's no longer done in the builder

  let currentSource = fromSource.shared.get(current);
  if (!currentSource) {
    // console.log('\ncreating', type, isFrom, current, 'ws', world.shared);
    currentSource = fromSource.shared.createPath(current);

    // throw Error(`no current ${current} shared for "${isFrom}", ${currentSource}}`);
  }
  return currentSource;
};

export const getDomain = (domain: string, world: Partial<TWorld>) => world.domains.find((d) => d.name === domain);
export const getStepperAsDomain = (s: AStepper) => (<IHasDomains>(s as unknown)).domains ? <IHasDomains>(s as unknown) : undefined;

export const getDomains = async (steppers: AStepper[]) => {
  const domainWorld: { domains: TModuleDomain[] } = { domains: [] };

  for (const module of steppers.map(s => getStepperAsDomain(s)).filter(s => s !== undefined)) {
    const { domains } = module;
    if (domains) {
      for (const d of domains) {
        if (getDomain(d.name, domainWorld)) {
          throw Error(`duplicate domain "${d.name}" in "${module.constructor.name}"`);
        }
        domainWorld.domains.push({ ...d, module, shared: new DomainContext(d.name) });
      }
    }
  }
  return domainWorld.domains;
};

export const verifyDomainsOrError = async (steppers: AStepper[], world: TWorld) => {
  // verify all required are present
  for (const s of steppers.filter((s) => !!(<IRequireDomains>s).requireDomains).map((s) => <IRequireDomains>s)) {
    const { requireDomains } = s;
    const { name: module } = s.constructor;
    if (requireDomains) {
      for (const name of requireDomains) {
        if (!getDomain(name, world)) {
          throw Error(`missing required domain "${name}" for ${module} from ${Object.keys(world.domains)}`);
          // return { result: { ok: false, failure: { stage: 'Options', error: { details: `missing required domain ${name} in ${name}`, context: world.domains } } } };
        }
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

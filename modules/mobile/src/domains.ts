import { TDomainDefinition, TStepValue } from '@haibun/core/lib/defs.js';
import { DOMAIN_STRING } from '@haibun/core/lib/domain-types.js';

export const MOBILE_TESTID = 'mobile-testid';
export const MOBILE_ACCESSIBILITY = 'mobile-accessibility';
export const MOBILE_XPATH = 'mobile-xpath';

export const MobileDomains: TDomainDefinition[] = [
  {
    selectors: [MOBILE_TESTID],
    coerce: (proto: TStepValue) => `~${String(proto.value)}`,
  },
  {
    selectors: [MOBILE_ACCESSIBILITY],
    coerce: (proto: TStepValue) => `~${String(proto.value)}`,
  },
  {
    selectors: [MOBILE_XPATH],
    coerce: (proto: TStepValue) => String(proto.value),
  },
  {
    selectors: [MOBILE_TESTID, MOBILE_ACCESSIBILITY, MOBILE_XPATH, DOMAIN_STRING],
    coerce: (proto: TStepValue) => {
      if (proto.domain === MOBILE_XPATH) {
        return String(proto.value);
      }
      if (proto.domain === MOBILE_TESTID || proto.domain === MOBILE_ACCESSIBILITY) {
        return `~${String(proto.value)}`;
      }
      return String(proto.value);
    },
  },
];

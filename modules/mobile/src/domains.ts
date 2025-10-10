import { TDomainDefinition, TStepValue } from '@haibun/core/lib/defs.js';
import { DOMAIN_STRING } from '@haibun/core/lib/domain-types.js';

export const MOBILE_TESTID = 'mobile-testid';
export const MOBILE_ACCESSIBILITY = 'mobile-accessibility';
export const MOBILE_XPATH = 'mobile-xpath';

export const MobileDomains: TDomainDefinition[] = [
  {
    selectors: [MOBILE_TESTID],
    // testID in React Native maps to resource-id on Android and accessibilityIdentifier on iOS
    // Use id: prefix for Android resource-id, ~ for iOS accessibility identifier
    coerce: (proto: TStepValue) => String(proto.value), // Will be used as resource-id selector
  },
  {
    selectors: [MOBILE_ACCESSIBILITY],
    // accessibilityLabel maps to content-desc (accessibility id) - use ~ prefix
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
      if (proto.domain === MOBILE_TESTID) {
        // resource-id selector - no prefix needed, will use id strategy
        return String(proto.value);
      }
      if (proto.domain === MOBILE_ACCESSIBILITY) {
        // accessibility id - use ~ prefix
        return `~${String(proto.value)}`;
      }
      return String(proto.value);
    },
  },
];

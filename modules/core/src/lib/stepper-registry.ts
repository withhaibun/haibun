import { AStepper } from './astepper.js';
import { constructorName } from './util/index.js';
import { namedInterpolation } from './namedVars.js';

/**
 * Metadata for a single step, extracted from a stepper definition.
 * Used by both LSP (for autocomplete/hover) and MCP (for tool registration).
 */
export interface StepMetadata {
  stepperName: string;
  stepName: string;
  pattern: string;
  params: Record<string, 'string' | 'number'>;
}

/**
 * Central registry for extracting step metadata from steppers.
 * Ensures that LSP and MCP share identical step definitions.
 */
export class StepperRegistry {
  /**
   * Extract metadata from all steps in the provided steppers.
   * Filters out steps marked with `expose: false`.
   */
  static getMetadata(steppers: AStepper[]): StepMetadata[] {
    return steppers.flatMap(stepper => {
      const stepperName = constructorName(stepper);
      return Object.entries(stepper.steps)
        .filter(([, def]) => def.expose !== false)
        .map(([stepName, stepDef]) => {
          const params: Record<string, 'string' | 'number'> = {};
          const pattern = stepDef.gwta || stepDef.exact || stepDef.match?.toString() || stepName;

          if (stepDef.gwta) {
            const { stepValuesMap } = namedInterpolation(stepDef.gwta);
            if (stepValuesMap) {
              for (const v of Object.values(stepValuesMap)) {
                // Treat 'number' domain as number type, everything else as string
                params[v.term] = v.domain === 'number' ? 'number' : 'string';
              }
            }
          }
          return { stepperName, stepName, pattern, params };
        });
    });
  }

  /**
   * Convert a gwta pattern to an LSP snippet format.
   * Transforms `{varName}` to `${1:varName}` for tab-stop support.
   */
  static patternToSnippet(pattern: string): string {
    let i = 1;
    return pattern.replace(/\{(\w+)(?::\s*\w+)?\}/g, (_, name) => `\${${i++}:${name}}`);
  }
}

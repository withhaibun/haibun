import { AStepper, TStepperSteps } from '../lib/astepper.js';
import { namedInterpolation } from '../lib/namedVars.js';

type TStepWithGwta = TStepperSteps[keyof TStepperSteps] & { gwta: string };

const isStepWithGwta = (step: any): step is TStepWithGwta => {
  return typeof step.gwta === 'string';
};

// A helper to replace placeholders in a gwta string with their values.
const interpolateGwta = (gwta: string, args: { [key: string]: string }): string => {
  let interpolated = gwta;
  for (const key in args) {
    const placeholder = `{${key}}`;
    const placeholderWithDomain = new RegExp(`\\{${key}:.*\\}`);
    interpolated = interpolated.replace(placeholder, args[key]);
    interpolated = interpolated.replace(placeholderWithDomain, args[key]);
  }
  return interpolated;
};

// --- Start of TypeScript Magic ---

// Extracts argument names from a gwta string.
type TExtractArgs<S extends string> = S extends `${string}{${infer P}}${infer R}` ? [...TParsePair<P>, ...TExtractArgs<R>] : [];

// Parses a placeholder like "name:domain" into just "name".
type TParsePair<P extends string> = P extends `${infer Name}:${string}` ? [Name] : P extends `${infer Name}` ? [Name] : [];

// Creates a record type from a tuple of keys. All values are strings for now.
type TArgs<T extends ReadonlyArray<string>> = { [K in T[number]]: string };

// The arguments for a given step.
type TActionArgs<S extends string> = TArgs<TExtractArgs<S>>;

// The return type of a curried action. It's a function that returns an object
// representing the action to be executed.
type TActionExecutor<S extends string> = () => {
  actionName: string;
  args: TActionArgs<S>;
  gwta: string;
};

// The type for a single curried action function.
type TCurriedAction<S extends string> = (args: TActionArgs<S>) => TActionExecutor<S>;

// This is the main type. It maps over a stepper's steps and creates
// a fully typed object of curried action functions.
type TActionsFromStepper<S extends TStepperSteps> = {
  [K in keyof S]: S[K] extends { gwta: infer G }
    ? G extends string
      ? TCurriedAction<G>
      : never
    : never;
};

// --- End of TypeScript Magic ---


export const withAction = <T extends AStepper>(stepper: T): TActionsFromStepper<T['steps']> => {
  const actions: { [key: string]: Function } = {};

  for (const actionName in stepper.steps) {
    const step = stepper.steps[actionName];

    if (isStepWithGwta(step)) {
      const { stepValuesMap } = namedInterpolation(step.gwta);
      const argNames = stepValuesMap ? Object.keys(stepValuesMap) : [];

      actions[actionName] = (args: { [key: string]: string }) => {
        // Simple validation to ensure all required arguments are provided at runtime.
        for (const name of argNames) {
          if (args[name] === undefined) {
            throw new Error(`Missing argument "${name}" for action "${actionName}"`);
          }
        }

        return () => ({
          actionName,
          args,
          // We also return the interpolated gwta string, which can be used
          // for logging or converting to BDD format.
          gwta: interpolateGwta(step.gwta, args),
        });
      };
    }
  }

  return actions as TActionsFromStepper<T['steps']>;
};

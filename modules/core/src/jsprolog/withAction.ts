import { AStepper, TStepperSteps } from '../lib/astepper.js';
import { namedInterpolation } from '../lib/namedVars.js';

type TStepWithGwta = TStepperSteps[keyof TStepperSteps] & { gwta: string };

const isStepWithGwta = (step: any): step is TStepWithGwta => {
  return typeof step.gwta === 'string';
};

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

type TExtractArgs<S extends string> = S extends `${string}{${infer P}}${infer R}` ? [...TParsePair<P>, ...TExtractArgs<R>] : [];

type TParsePair<P extends string> = P extends `${infer Name}:${string}` ? [Name] : P extends `${infer Name}` ? [Name] : [];

type TArgs<T extends ReadonlyArray<string>> = { [K in T[number]]: string };

type TActionArgs<S extends string> = TArgs<TExtractArgs<S>>;

export type TActionExecutor<S extends string> = () => {
  actionName: string;
  args: TActionArgs<S>;
  gwta: string;
};

export type TCurriedAction<S extends string> = (args: TActionArgs<S>) => TActionExecutor<S>;

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
        // Re-introducing runtime validation for missing arguments.
        for (const name of argNames) {
          if (args[name] === undefined) {
            throw new Error(`Missing argument "${name}" for action "${actionName}"`);
          }
        }

        return () => ({
          actionName,
          args,
          gwta: interpolateGwta(step.gwta, args),
        });
      };
    }
  }

  return actions as TActionsFromStepper<T['steps']>;
};

import { z } from 'zod';
import { AStepper } from "./astepper.js";
import { TDomainDefinition, TFeatureStep, TWorld } from './defs.js';
import { TStepValue } from '../schema/protocol.js';
import { DOMAIN_DATE, DOMAIN_JSON, DOMAIN_NUMBER, DOMAIN_STATEMENT, DOMAIN_STRING, mapDefinitionsToDomains } from './domain-types.js';
import { findFeatureStepsFromStatement } from "../phases/Resolver.js";

const numberSchema = z.coerce.number({ error: 'invalid number' })
	.refine((value) => Number.isFinite(value), 'invalid number');
const stringSchema = z.coerce.string({ error: 'value is required' });
const jsonStringSchema = z.string({ error: 'json value is required' });
const statementSchema = z.string({ error: 'statement label is required' }).min(1, 'statement cannot be empty');
const dateSchema = z.coerce.date({ error: 'invalid date' });

const getCoreDomainDefinitions = (world: TWorld): TDomainDefinition[] => ([
	{
		selectors: [DOMAIN_STRING],
		schema: stringSchema,
		description: 'Plain string literal captured from feature text.'
	},
	{
		selectors: [DOMAIN_NUMBER],
		schema: numberSchema,
		description: 'Numeric literal coerced with Number().',
		comparator: (value, baseline) => (value as number) - (baseline as number),
	},
	{
		selectors: [DOMAIN_DATE],
		schema: dateSchema,
		description: 'Date object derived from ISO timestamp, epoch ms, or Date literal.',
		comparator: (value, baseline) => (value as Date).getTime() - (baseline as Date).getTime(),
	},
	{
		selectors: [DOMAIN_JSON],
		schema: jsonStringSchema,
		description: 'JSON string parsed into native JavaScript values.',
		coerce: (proto: TStepValue) => {
			const raw = jsonStringSchema.parse(proto.value);
			try {
				return JSON.parse(raw);
			} catch {
				throw new Error(`invalid json '${raw}'`);
			}
		},
	},
	{
		selectors: [DOMAIN_STATEMENT],
		schema: statementSchema,
		description: 'Reference to another Haibun statement.',
		coerce: (proto: TStepValue, featureStep: TFeatureStep, steppers: AStepper[]) => {
			if (!featureStep || !steppers) {
				throw new Error('statement domain coercion requires feature context');
			}
			const label = statementSchema.parse(proto.value);
			const seqStart = featureStep.seqPath;
			return findFeatureStepsFromStatement(label, steppers, world, featureStep.source.path, [...seqStart, 0], -1);
		}
	},
]);

// Core domain registry factory. Returns coercion functions for built-in domains.
export const getCoreDomains = (world: TWorld) => mapDefinitionsToDomains(getCoreDomainDefinitions(world));

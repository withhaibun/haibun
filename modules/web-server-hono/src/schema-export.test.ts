import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  RouteTypeSchema,
  StaticFolderOptionsSchema,
  ROUTE_TYPES,
} from './defs.js';

describe('JSON Schema / OpenAPI exports', () => {
  describe('RouteTypeSchema', () => {
    it('should convert to valid JSON Schema', () => {
      const jsonSchema = zodToJsonSchema(RouteTypeSchema, 'RouteType');

      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(jsonSchema.definitions).toBeDefined();
      expect(jsonSchema.definitions?.RouteType).toBeDefined();
    });

    it('should define valid enum values for HTTP methods', () => {
      const jsonSchema = zodToJsonSchema(RouteTypeSchema, 'RouteType');
      const routeTypeDef = jsonSchema.definitions?.RouteType as { enum?: string[] };

      // Verify all defined route types are in the enum
      for (const routeType of ROUTE_TYPES) {
        expect(routeTypeDef.enum).toContain(routeType);
      }
    });
  });

  describe('StaticFolderOptionsSchema', () => {
    it('should convert to valid JSON Schema', () => {
      const jsonSchema = zodToJsonSchema(StaticFolderOptionsSchema, 'StaticFolderOptions');

      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(jsonSchema.definitions).toBeDefined();
      expect(jsonSchema.definitions?.StaticFolderOptions).toBeDefined();
    });

    it('should define index property as optional boolean', () => {
      // Use $refStrategy: 'none' for simpler output
      const jsonSchema = zodToJsonSchema(StaticFolderOptionsSchema, {
        $refStrategy: 'none',
      });

      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toBeDefined();
      expect((jsonSchema.properties as Record<string, { type?: string }>)?.index?.type).toBe('boolean');
    });
  });

  describe('OpenAPI compatibility', () => {
    it('RouteTypeSchema should produce OpenAPI-compatible enum', () => {
      const jsonSchema = zodToJsonSchema(RouteTypeSchema, {
        $refStrategy: 'none',
      });

      // OpenAPI uses 'enum' directly on the type
      expect(jsonSchema.type).toBe('string');
      expect(jsonSchema.enum).toBeDefined();
      expect(Array.isArray(jsonSchema.enum)).toBe(true);
      expect(jsonSchema.enum?.length).toBe(ROUTE_TYPES.length);
    });

    it('StaticFolderOptionsSchema should produce OpenAPI-compatible object', () => {
      const jsonSchema = zodToJsonSchema(StaticFolderOptionsSchema, {
        $refStrategy: 'none',
      });

      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toBeDefined();
    });
  });
});

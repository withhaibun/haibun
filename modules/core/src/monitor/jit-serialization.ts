import { THaibunEvent } from '../schema/events.js';

interface JITSchema {
  _meta: 'schema';
  id: string;
  fields: string[];
}

interface JITData {
  s: string;
  d: any[];
}

type JITLine = JITSchema | JITData;

export class JITSerializer {
  private schemas = new Map<string, string[]>();
  private nextSchemaId = 1;

  serialize(events: THaibunEvent[]): string {
    const lines: string[] = [];
    this.schemas.clear();
    this.nextSchemaId = 1;

    for (const event of events) {
      const schemaId = this.getSchemaId(event);
      const schemaFields = this.schemas.get(schemaId)!;

      // If first use of this schema, emit definition
      if (!lines.some(l => l.includes(`"_meta":"schema","id":"${schemaId}"`))) {
        lines.push(JSON.stringify({
          _meta: 'schema',
          id: schemaId,
          fields: schemaFields
        }));
      }

      // Emit data
      const validFields = schemaFields.map(f => (event as any)[f]);
      lines.push(JSON.stringify({ s: schemaId, d: validFields }));
    }

    return lines.join('\n');
  }

  deserialize(input: string): THaibunEvent[] {
    const lines = input.split('\n').filter(Boolean);
    const schemas = new Map<string, string[]>();
    const events: THaibunEvent[] = [];

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj._meta === 'schema') {
          schemas.set(obj.id, obj.fields);
        } else if (obj.s && obj.d) {
          const fields = schemas.get(obj.s);
          if (fields) {
            const event: any = {};
            fields.forEach((field, i) => {
              event[field] = obj.d[i];
            });
            events.push(event);
          }
        }
      } catch (e) {
        console.error('Failed to parse JIT line', line, e);
      }
    }
    return events;
  }

  private getSchemaId(event: THaibunEvent): string {
    // Determine schema based on event structure (keys)
    const keys = Object.keys(event).sort();
    const signature = keys.join(','); // Simple signature based on field presence

    // Check if we have a schema for this signature
    for (const [id, fields] of this.schemas.entries()) {
      if (fields.join(',') === signature) {
        return id;
      }
    }

    // Create new schema for unseen field signature
    const newId = `${event.kind}-${this.nextSchemaId++}`;
    this.schemas.set(newId, keys);
    return newId;
  }
}

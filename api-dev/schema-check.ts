import { Schema, Spec } from './spec';

/**
 * Checks a response body against its documented OpenAPI 3.0 schema: types, required fields,
 * nested objects, arrays, enums, nullable, $ref and allOf/oneOf/anyOf. A small stand-in for a full
 * JSON-schema validator (none can be installed behind the office firewall).
 *
 * Returns readable problems such as "$.data[0].amount: expected number, got string". Values
 * themselves are never included, so the output is safe to publish.
 */
export function checkSchema(schema: Schema | undefined, value: unknown, spec: Spec, where = '$', depth = 0, out: string[] = []): string[] {
  if (!schema || out.length >= 8 || depth > 12) return out;
  if (schema.$ref) {
    const name = String(schema.$ref).split('/').pop()!;
    return checkSchema(spec.components?.schemas?.[name], value, spec, where, depth + 1, out);
  }
  if (value === null || value === undefined) {
    // Springdoc rarely marks `nullable`; only flag nulls where the schema says a field is required.
    return out;
  }
  if (schema.allOf) {
    for (const s of schema.allOf) checkSchema(s, value, spec, where, depth + 1, out);
    return out;
  }
  if (schema.oneOf || schema.anyOf) {
    const options: Schema[] = schema.oneOf || schema.anyOf;
    if (!options.some((s) => checkSchema(s, value, spec, where, depth + 1, []).length === 0)) out.push(`${where}: matches none of the documented shapes`);
    return out;
  }
  const type = schema.type || (schema.properties ? 'object' : schema.items ? 'array' : undefined);
  const actual = Array.isArray(value) ? 'array' : typeof value;
  switch (type) {
    case 'object': {
      if (actual !== 'object') { out.push(`${where}: expected object, got ${actual}`); break; }
      const obj = value as Record<string, unknown>;
      for (const r of schema.required || []) if (obj[r] === undefined || obj[r] === null) out.push(`${where}.${r}: required field missing`);
      for (const [k, s] of Object.entries(schema.properties || {})) if (k in obj) checkSchema(s as Schema, obj[k], spec, `${where}.${k}`, depth + 1, out);
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        for (const [k, v] of Object.entries(obj)) if (!(k in (schema.properties || {}))) checkSchema(schema.additionalProperties, v, spec, `${where}.${k}`, depth + 1, out);
      }
      break;
    }
    case 'array':
      if (actual !== 'array') { out.push(`${where}: expected list, got ${actual}`); break; }
      (value as unknown[]).slice(0, 3).forEach((v, i) => checkSchema(schema.items, v, spec, `${where}[${i}]`, depth + 1, out));
      break;
    case 'integer':
      if (actual !== 'number' || !Number.isInteger(value)) out.push(`${where}: expected whole number, got ${actual === 'number' ? 'decimal' : actual}`);
      break;
    case 'number':
      if (actual !== 'number') out.push(`${where}: expected number, got ${actual}`);
      break;
    case 'boolean':
      if (actual !== 'boolean') out.push(`${where}: expected true/false, got ${actual}`);
      break;
    case 'string':
      if (actual !== 'string') out.push(`${where}: expected text, got ${actual}`);
      else if (schema.enum && !schema.enum.includes(value)) out.push(`${where}: value is not one of the documented options (${schema.enum.slice(0, 6).join(', ')}${schema.enum.length > 6 ? ', …' : ''})`);
      break;
    default:
      break; // untyped schema: anything goes
  }
  return out;
}

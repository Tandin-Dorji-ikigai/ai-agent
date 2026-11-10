// Turns our zod schemas into JSON Schemas that strict structured output
// accepts (every property required, no extra properties, optional fields
// become nullable). Length/format/range rules are stripped for the model and
// still enforced afterwards by zod, so nothing is lost.

import { z } from "zod";

type Json = Record<string, unknown>;

const DROP = new Set([
  "$schema",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "default",
]);

function nullable(node: Json): Json {
  if (Array.isArray(node.anyOf)) {
    return (node.anyOf as Json[]).some((n) => n.type === "null") ? node : { anyOf: [...(node.anyOf as Json[]), { type: "null" }] };
  }
  return { anyOf: [node, { type: "null" }] };
}

export function strictify(node: Json): Json {
  if (Array.isArray(node.anyOf)) return { anyOf: (node.anyOf as Json[]).map(strictify) };
  if (node.type === "object" || node.properties) {
    const props = (node.properties ?? {}) as Record<string, Json>;
    const required = new Set((node.required as string[] | undefined) ?? []);
    const out: Record<string, Json> = {};
    for (const [key, child] of Object.entries(props)) {
      const s = strictify(child);
      out[key] = required.has(key) ? s : nullable(s);
    }
    return { type: "object", properties: out, required: Object.keys(props), additionalProperties: false };
  }
  const copy: Json = {};
  for (const [k, v] of Object.entries(node)) {
    if (DROP.has(k)) continue;
    copy[k] = k === "items" && v && typeof v === "object" ? strictify(v as Json) : v;
  }
  return copy;
}

export function toStrictJsonSchema(schema: z.ZodType): Json {
  return strictify(z.toJSONSchema(schema, { io: "output" }) as Json);
}

/** Removes null values so zod's .optional() fields accept "not provided". */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== null) out[k] = stripNulls(v);
    return out;
  }
  return value;
}

import { describe, expect, it } from "vitest";
import { stripNulls, toStrictJsonSchema } from "./json-schema";
import { BriefsSchema, ExtractionSchema, ExtractionSchema as E, ReplyClassificationSchema } from "./schemas";

type Node = Record<string, unknown>;

function walk(node: Node, visit: (n: Node) => void) {
  visit(node);
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((x) => x && typeof x === "object" && walk(x as Node, visit));
    else if (v && typeof v === "object") walk(v as Node, visit);
  }
}

describe("strict JSON schema for the AI", () => {
  it("makes every object strict: all properties required, no extras", () => {
    for (const schema of [BriefsSchema, ExtractionSchema, ReplyClassificationSchema]) {
      walk(toStrictJsonSchema(schema), (n) => {
        if (n.type === "object") {
          expect(n.additionalProperties).toBe(false);
          expect(n.required).toEqual(Object.keys(n.properties as Node));
        }
      });
    }
  });

  it("turns optional fields into nullable ones and drops length rules", () => {
    const s = toStrictJsonSchema(E) as Node;
    const action = ((s.properties as Node).actions as Node).items as Node;
    const measure = (action.properties as Node).success_measure as Node;
    expect(JSON.stringify(measure)).toContain('"null"');
    const json = JSON.stringify(s);
    for (const k of ["minLength", "maxLength", "pattern", "format", "$schema"]) expect(json).not.toContain(`"${k}"`);
  });

  it("strips nulls so optional fields validate", () => {
    const raw = { summary: "s", actions: [{ title: "Do it", description: null, success_measure: null, owner: "entrepreneur", due_in_days: 4 }] };
    expect(ExtractionSchema.safeParse(stripNulls(raw)).success).toBe(true);
  });
});

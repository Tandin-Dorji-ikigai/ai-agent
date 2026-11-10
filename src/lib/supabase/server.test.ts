import { describe, expect, it } from "vitest";
import { DbError, MigrationsRequiredError, must } from "./server";

const fail = (code: string, message: string) => ({ data: null, error: { code, message } });

describe("database errors", () => {
  it("reports a missing table, column or function as missing migrations", () => {
    for (const code of ["PGRST205", "PGRST202", "PGRST204", "42P01", "42703"]) {
      expect(() => must(fail(code, "x"), "load")).toThrow(MigrationsRequiredError);
    }
  });

  it("does not mistake other errors that mention 'does not exist' or the schema cache for missing migrations", () => {
    const other = [
      fail("42883", "operator does not exist: text = uuid"),
      fail("PGRST200", "Could not find a relationship between 'a' and 'b' in the schema cache"),
      fail("23505", "duplicate key value violates unique constraint"),
    ];
    for (const r of other) {
      let err: unknown;
      try {
        must(r, "load");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(DbError);
      expect(err).not.toBeInstanceOf(MigrationsRequiredError);
    }
  });

  it("keeps the database code and message, so tools and logs can report them", () => {
    try {
      must(fail("PGRST205", "Could not find the table 'public.mentor_requests' in the schema cache"), "load requests");
    } catch (e) {
      expect(e).toBeInstanceOf(DbError);
      expect((e as DbError).pgCode).toBe("PGRST205");
      expect((e as Error).message).toContain("mentor_requests");
    }
  });
});

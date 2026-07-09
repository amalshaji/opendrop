import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pgOpenDropSchema, sqliteOpenDropSchema } from "@opendrop/shared/db/schema";

const expectedTables = [
  "account",
  "annotations",
  "cli_tokens",
  "deployment_families",
  "deployment_files",
  "deployment_versions",
  "device_authorizations",
  "identities",
  "namespace_members",
  "namespaces",
  "session",
  "user",
  "users",
  "verification"
];

describe("drizzle schema", () => {
  it("covers every table created by the initial migration", () => {
    const migration = readFileSync("packages/shared/migrations/0001_initial.sql", "utf8");
    const migrationTables = [...migration.matchAll(/create table if not exists "?([a-z_]+)"?/g)].map((match) => match[1]).sort();

    expect(migrationTables).toEqual(expectedTables);
    expect(tableNames(sqliteOpenDropSchema)).toEqual(expectedTables);
    expect(tableNames(pgOpenDropSchema)).toEqual(expectedTables);
  });

  it("includes PostgreSQL conversions for Better Auth booleans and dates", () => {
    const migration = readFileSync("packages/shared/migrations/postgres/0001_better_auth_native_types.sql", "utf8");
    expect(migration).toContain("type boolean");
    expect(migration).toContain("type timestamptz");
    expect(migration).toContain("to_timestamp");
  });
});

function tableNames(schema: Record<string, { [key: symbol]: unknown }>): string[] {
  return Object.values(schema)
    .map((table) => {
      const tableNameSymbol = Object.getOwnPropertySymbols(table).find((symbol) => symbol.toString() === "Symbol(drizzle:Name)");
      return tableNameSymbol ? String(table[tableNameSymbol]) : "";
    })
    .filter(Boolean)
    .sort();
}

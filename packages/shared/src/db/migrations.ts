import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "bun:sqlite";
import type { Pool } from "pg";

interface MigrationSource {
  directory: string;
  prefix?: string;
}

interface SqlMigration {
  id: string;
  checksum: string;
  sql: string;
}

const journalTableSql = `
  create table if not exists opendrop_migrations (
    id text primary key,
    checksum text not null,
    applied_at text not null
  )
`;

export function runSqliteMigrations(db: Database, sources: MigrationSource[]): void {
  db.exec(journalTableSql);
  const applied = new Map(
    (db.query("select id, checksum from opendrop_migrations").all() as Array<{ id: string; checksum: string }>).map((row) => [row.id, row.checksum])
  );

  for (const migration of loadMigrations(sources)) {
    assertUnchangedMigration(applied, migration);
    if (applied.has(migration.id)) continue;
    db.transaction((pending: SqlMigration) => {
      db.exec(pending.sql);
      db.prepare("insert into opendrop_migrations (id, checksum, applied_at) values (?, ?, ?)")
        .run(pending.id, pending.checksum, new Date().toISOString());
    })(migration);
    applied.set(migration.id, migration.checksum);
  }
}

export async function runPostgresMigrations(pool: Pool, sources: MigrationSource[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", ["opendrop:migrations"]);
    await client.query(journalTableSql);
    const appliedRows = await client.query<{ id: string; checksum: string }>("select id, checksum from opendrop_migrations");
    const applied = new Map(appliedRows.rows.map((row) => [row.id, row.checksum]));

    for (const migration of loadMigrations(sources)) {
      assertUnchangedMigration(applied, migration);
      if (applied.has(migration.id)) continue;
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query("insert into opendrop_migrations (id, checksum, applied_at) values ($1, $2, $3)", [
          migration.id,
          migration.checksum,
          new Date().toISOString()
        ]);
        await client.query("commit");
        applied.set(migration.id, migration.checksum);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", ["opendrop:migrations"]).catch(() => undefined);
    client.release();
  }
}

function loadMigrations(sources: MigrationSource[]): SqlMigration[] {
  return sources.flatMap(({ directory, prefix = "" }) =>
    readdirSync(directory)
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort()
      .map((file) => {
        const sql = readFileSync(resolve(directory, file), "utf8");
        return {
          id: `${prefix}${file}`,
          checksum: createHash("sha256").update(sql).digest("hex"),
          sql
        };
      })
  );
}

function assertUnchangedMigration(applied: Map<string, string>, migration: SqlMigration): void {
  const checksum = applied.get(migration.id);
  if (checksum && checksum !== migration.checksum) {
    throw new Error(`Applied migration ${migration.id} has been modified.`);
  }
}

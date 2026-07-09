import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BunSqliteOpenDropRepository } from "../../packages/shared/src/db/sqlite";
import { createD1Repository, type D1DatabaseLike, type D1PreparedStatementLike } from "../../packages/shared/src/db/d1";
import { runSqliteMigrations } from "../../packages/shared/src/db/migrations";
import { createRawCliToken, hashToken } from "../../packages/shared/src/db/tokens";
import { expectOpenDropRepositoryContract } from "./repository-contract";

const sqliteDir = await mkdtemp(join(tmpdir(), "opendrop-sqlite-"));
await expectOpenDropRepositoryContract(new BunSqliteOpenDropRepository(join(sqliteDir, "opendrop.sqlite")));
console.log("sqlite repository contract passed");

const concurrentPath = join(sqliteDir, "concurrent.sqlite");
const concurrentRepoA = new BunSqliteOpenDropRepository(concurrentPath);
const concurrentRepoB = new BunSqliteOpenDropRepository(concurrentPath);
await concurrentRepoA.migrate();
await concurrentRepoB.migrate();
const concurrentUser = await concurrentRepoA.getOrCreateUser({
  provider: "oauth",
  subject: "concurrent-user",
  email: "concurrent@example.com"
});
await concurrentRepoA.createDeviceAuthorization({
  deviceCodeHash: "concurrent-device-hash",
  userCode: "RACE-CODE",
  expiresAt: new Date(Date.now() + 60_000).toISOString()
});
await concurrentRepoA.approveDeviceAuthorization("RACE-CODE", concurrentUser.id);
const concurrentTokens = [createRawCliToken(), createRawCliToken()];
const concurrentResults = await Promise.all([
  concurrentRepoA.exchangeDeviceAuthorization("concurrent-device-hash", await hashToken(concurrentTokens[0]!)),
  concurrentRepoB.exchangeDeviceAuthorization("concurrent-device-hash", await hashToken(concurrentTokens[1]!))
]);
assert.equal(concurrentResults.filter((result) => result?.status === "issued").length, 1);
assert.equal(concurrentResults.filter((result) => result?.status === "already_exchanged").length, 1);
console.log("sqlite concurrent device exchange contract passed");

const migrationDir = await mkdtemp(join(tmpdir(), "opendrop-migrations-"));
const migrationPath = join(migrationDir, "0001_create_example.sql");
await writeFile(migrationPath, "create table example (id text primary key);\n");
const migrationDb = new Database(":memory:");
runSqliteMigrations(migrationDb, [{ directory: migrationDir }]);
runSqliteMigrations(migrationDb, [{ directory: migrationDir }]);
assert.equal((migrationDb.query("select count(*) as count from opendrop_migrations").get() as { count: number }).count, 1);
await writeFile(migrationPath, "create table example (id text primary key, name text);\n");
assert.throws(() => runSqliteMigrations(migrationDb, [{ directory: migrationDir }]), /has been modified/);
console.log("sqlite migration journal contract passed");

const d1Db = new Database(":memory:");
applyD1Migrations(d1Db);
await expectOpenDropRepositoryContract(createD1Repository(new SqliteD1Database(d1Db)));
console.log("d1-compatible repository contract passed");

const atomicD1Db = new Database(":memory:");
applyD1Migrations(atomicD1Db);
const atomicRepo = createD1Repository(new SqliteD1Database(atomicD1Db, 1));
await assert.rejects(() => atomicRepo.getOrCreateUser({
  provider: "oauth",
  subject: "atomic-user",
  email: "atomic@example.com"
}), /injected D1 batch failure/);
for (const table of ["users", "identities", "namespaces"]) {
  const row = atomicD1Db.query(`select count(*) as count from ${table}`).get() as { count: number };
  assert.equal(Number(row.count), 0);
}
console.log("d1 provisioning rollback contract passed");

function applyD1Migrations(db: Database): void {
  for (const file of readdirSync(resolve("packages/shared/migrations")).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(resolve("packages/shared/migrations", file), "utf8"));
  }
}

class SqliteD1Database implements D1DatabaseLike {
  constructor(
    private db: Database,
    private failNextBatchAt?: number
  ) {}

  prepare(query: string): D1PreparedStatementLike {
    return new SqliteD1PreparedStatement(this.db, query, []);
  }

  async batch(statements: D1PreparedStatementLike[]) {
    const failAt = this.failNextBatchAt;
    this.failNextBatchAt = undefined;
    return this.db.transaction((items: D1PreparedStatementLike[]) =>
      items.map((statement, index) => {
        if (index === failAt) throw new Error("injected D1 batch failure");
        if (!(statement instanceof SqliteD1PreparedStatement)) throw new Error("Unsupported D1 statement.");
        return statement.runSync();
      })
    )(statements);
  }

  async exec(query: string): Promise<unknown> {
    this.db.exec(query);
    return undefined;
  }
}

class SqliteD1PreparedStatement implements D1PreparedStatementLike {
  constructor(
    private db: Database,
    private query: string,
    private values: unknown[]
  ) {}

  bind(...values: unknown[]): D1PreparedStatementLike {
    return new SqliteD1PreparedStatement(this.db, this.query, values);
  }

  async first<T = unknown>(): Promise<T | null> {
    return (this.db.prepare(this.query).get(...this.values) as T | null) ?? null;
  }

  async all<T = unknown>(): Promise<{ results?: T[] }> {
    return { results: this.db.prepare(this.query).all(...this.values) as T[] };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return this.db.prepare(this.query).values(...this.values) as T[];
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const result = this.db.prepare(this.query).run(...this.values);
    return { meta: { changes: result.changes } };
  }
}

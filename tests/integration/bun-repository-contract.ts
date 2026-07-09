import { Database } from "bun:sqlite";
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BunSqliteOpenDropRepository } from "../../packages/shared/src/db/sqlite";
import { createD1Repository, type D1DatabaseLike, type D1PreparedStatementLike } from "../../packages/shared/src/db/d1";
import { expectOpenDropRepositoryContract } from "./repository-contract";

const sqliteDir = await mkdtemp(join(tmpdir(), "opendrop-sqlite-"));
await expectOpenDropRepositoryContract(new BunSqliteOpenDropRepository(join(sqliteDir, "opendrop.sqlite")));
console.log("sqlite repository contract passed");

const d1Db = new Database(":memory:");
d1Db.exec(readFileSync(resolve("packages/shared/migrations/0001_initial.sql"), "utf8"));
await expectOpenDropRepositoryContract(createD1Repository(new SqliteD1Database(d1Db)));
console.log("d1-compatible repository contract passed");

class SqliteD1Database implements D1DatabaseLike {
  constructor(private db: Database) {}

  prepare(query: string): D1PreparedStatementLike {
    return new SqliteD1PreparedStatement(this.db, query, []);
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

  async run(): Promise<unknown> {
    this.db.prepare(this.query).run(...this.values);
    return undefined;
  }
}

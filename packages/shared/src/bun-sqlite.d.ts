declare module "bun:sqlite" {
  export class Database {
    constructor(path: string);
    exec(sql: string): void;
    close(): void;
    prepare(sql: string): Statement;
    query(sql: string): Statement;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
  }

  export interface Statement {
    get(...params: unknown[]): any;
    all(...params: unknown[]): any[];
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }
}

import { describe, it } from "vitest";
import { createPostgresRepository } from "../../packages/shared/src/db/postgres";
import { expectOpenDropRepositoryContract } from "./repository-contract";

const databaseUrl = process.env.OPENDROP_POSTGRES_TEST_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("postgres repository contract", () => {
  it("satisfies the OpenDrop repository contract", async () => {
    await expectOpenDropRepositoryContract(createPostgresRepository(databaseUrl!));
  });
});

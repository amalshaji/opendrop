.PHONY: install dev dev-docker docker-down check test unit postgres-test e2e release-dry-run

install:
	bun install

dev:
	bun run dev

dev-docker:
	docker compose -f docker-compose.dev.yml up --build dev

docker-down:
	docker compose -f docker-compose.dev.yml down

check:
	bun run check

test:
	bun run test

unit:
	bun run test:unit

postgres-test:
	docker compose -f docker-compose.e2e.yml up -d postgres
	OPENDROP_POSTGRES_TEST_URL=postgres://opendrop:opendrop@127.0.0.1:15432/opendrop bun run test:postgres

e2e:
	docker compose -f docker-compose.e2e.yml up -d
	bun run test:e2e

release-dry-run:
	bun run release:dry-run

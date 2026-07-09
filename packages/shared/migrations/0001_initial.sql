create table if not exists "user" (
  "id" text primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null default 0,
  "image" text,
  "createdAt" integer not null,
  "updatedAt" integer not null
);

create table if not exists "session" (
  "id" text primary key,
  "expiresAt" integer not null,
  "token" text not null unique,
  "createdAt" integer not null,
  "updatedAt" integer not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user"("id")
);

create table if not exists "account" (
  "id" text primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user"("id"),
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" integer,
  "refreshTokenExpiresAt" integer,
  "scope" text,
  "password" text,
  "createdAt" integer not null,
  "updatedAt" integer not null
);

create table if not exists "verification" (
  "id" text primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" integer not null,
  "createdAt" integer,
  "updatedAt" integer
);

create table if not exists users (
  id text primary key,
  email text not null unique,
  name text,
  avatar_url text,
  default_namespace text not null unique,
  created_at text not null,
  updated_at text not null
);

create table if not exists identities (
  id text primary key,
  user_id text not null references users(id),
  provider text not null,
  provider_subject text not null,
  email text not null,
  created_at text not null,
  updated_at text not null,
  unique(provider, provider_subject)
);

create table if not exists namespaces (
  id text primary key,
  name text not null unique,
  owner_user_id text not null references users(id),
  created_at text not null
);

create table if not exists namespace_members (
  namespace_id text not null references namespaces(id),
  user_id text not null references users(id),
  role text not null,
  created_at text not null,
  primary key(namespace_id, user_id)
);

create table if not exists deployment_families (
  id text primary key,
  namespace_id text not null references namespaces(id),
  namespace_name text not null,
  slug text not null,
  owner_user_id text not null references users(id),
  latest_version_id text,
  visibility text not null,
  created_at text not null,
  updated_at text not null,
  unique(namespace_name, slug)
);

create table if not exists deployment_versions (
  id text primary key,
  family_id text not null references deployment_families(id),
  version_number integer not null,
  created_by_user_id text not null references users(id),
  manifest_hash text not null,
  file_count integer not null,
  total_bytes integer not null,
  created_at text not null,
  unique(family_id, version_number)
);

create table if not exists deployment_files (
  id text primary key,
  version_id text not null references deployment_versions(id),
  path text not null,
  size integer not null,
  sha256 text not null,
  content_type text not null,
  line_count integer,
  storage_key text not null,
  unique(version_id, path)
);

create table if not exists annotations (
  id text primary key,
  family_id text not null references deployment_families(id),
  version_id text not null references deployment_versions(id),
  parent_annotation_id text references annotations(id),
  page_path text not null,
  author_user_id text not null references users(id),
  body text not null,
  tags_json text not null,
  shape_json text not null,
  viewport_json text not null,
  resolved_at text,
  created_at text not null,
  updated_at text not null
);

create table if not exists cli_tokens (
  id text primary key,
  user_id text not null references users(id),
  token_hash text not null unique,
  label text,
  device_name text,
  user_agent text,
  created_at text not null,
  last_used_at text,
  revoked_at text
);

create table if not exists device_authorizations (
  id text primary key,
  device_code_hash text not null unique,
  user_code text not null unique,
  status text not null,
  user_id text references users(id),
  token_hash text,
  token_plain text,
  label text,
  device_name text,
  user_agent text,
  created_at text not null,
  expires_at text not null,
  approved_at text,
  rejected_at text
);

create index if not exists idx_deployment_versions_family on deployment_versions(family_id);
create index if not exists idx_deployment_files_version on deployment_files(version_id);
create index if not exists idx_annotations_family_version on annotations(family_id, version_id);
create index if not exists idx_annotations_parent on annotations(parent_annotation_id);

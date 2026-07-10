create table if not exists upload_sessions (
  id text primary key,
  owner_user_id text not null references users(id),
  namespace_name text not null,
  slug text not null,
  visibility text not null,
  version_id text not null unique,
  manifest_hash text not null,
  manifest_json text not null,
  status text not null,
  failure_reason text,
  expires_at text not null,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_upload_sessions_owner_status on upload_sessions(owner_user_id, status);

delete from cli_tokens
where token_hash in (
  select token_hash
  from device_authorizations
  where token_plain is not null and token_hash is not null
);

update device_authorizations
set status = case when status = 'approved' then 'rejected' else status end,
    token_hash = null,
    token_plain = null,
    rejected_at = case when status = 'approved' then cast(current_timestamp as text) else rejected_at end
where token_plain is not null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'user'
      and column_name = 'emailVerified' and data_type <> 'boolean'
  ) then
    alter table "user" alter column "emailVerified" drop default;
    alter table "user" alter column "emailVerified" type boolean
      using (case when "emailVerified" = 0 then false else true end);
    alter table "user" alter column "emailVerified" set default false;
  end if;
end $$;

do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('user', 'createdAt'),
      ('user', 'updatedAt'),
      ('session', 'expiresAt'),
      ('session', 'createdAt'),
      ('session', 'updatedAt'),
      ('account', 'accessTokenExpiresAt'),
      ('account', 'refreshTokenExpiresAt'),
      ('account', 'createdAt'),
      ('account', 'updatedAt'),
      ('verification', 'expiresAt'),
      ('verification', 'createdAt'),
      ('verification', 'updatedAt')
    ) as columns_to_convert(table_name, column_name)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = current_schema()
        and table_name = target.table_name
        and column_name = target.column_name
        and data_type not in ('timestamp with time zone', 'timestamp without time zone')
    ) then
      execute format(
        'alter table %I alter column %I type timestamptz using to_timestamp(%I::double precision / 1000.0)',
        target.table_name,
        target.column_name,
        target.column_name
      );
    end if;
  end loop;
end $$;

alter table idoc.google_oauth_transactions
  add column if not exists purpose varchar(40) not null default 'authentication',
  add column if not exists authenticated_user_id integer references idoc.users(id) on delete cascade;

alter table idoc.google_oauth_transactions
  drop constraint if exists google_oauth_transactions_purpose_check;

alter table idoc.google_oauth_transactions
  add constraint google_oauth_transactions_purpose_check
  check (
    (purpose = 'authentication' and authenticated_user_id is null)
    or (purpose = 'external_identity_link' and authenticated_user_id is not null)
  );

create table if not exists idoc.auth_security_notification_outbox (
  id serial primary key,
  user_id integer not null references idoc.users(id) on delete cascade,
  kind varchar(50) not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  last_error_code varchar(50),
  available_at timestamptz not null default now(),
  lease_owner varchar(100),
  lease_expires_at timestamptz,
  dead_lettered_at timestamptz,
  constraint auth_security_notification_kind_check
    check (kind in ('google_identity_linked', 'google_identity_unlinked'))
);

create index if not exists auth_security_notification_claim_idx
  on idoc.auth_security_notification_outbox (available_at, id)
  where sent_at is null and dead_lettered_at is null;

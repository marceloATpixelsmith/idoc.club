create table if not exists idoc.operational_alert_outbox (
  id serial primary key,
  kind varchar(50) not null,
  subject text not null,
  body_html text not null,
  dedupe_key varchar(150) not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  last_error_code varchar(50),
  available_at timestamptz not null default now(),
  lease_owner varchar(100),
  lease_expires_at timestamptz,
  dead_lettered_at timestamptz,
  constraint operational_alert_outbox_kind_check
    check (kind in ('rate_limit_correlation_alert'))
);
--> statement-breakpoint
create unique index if not exists operational_alert_outbox_dedupe_key_unique
  on idoc.operational_alert_outbox (dedupe_key);
--> statement-breakpoint
create index if not exists operational_alert_outbox_claim_idx
  on idoc.operational_alert_outbox (available_at, id)
  where sent_at is null and dead_lettered_at is null;

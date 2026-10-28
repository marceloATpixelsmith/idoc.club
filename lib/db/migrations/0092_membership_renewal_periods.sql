-- Preserve membership expiration periods as durable cohort evidence.
-- A renewal can change memberships.valid_until in place. Without this history,
-- paid members disappear from the expiration cohort they successfully renewed.
create table if not exists idoc.membership_renewal_periods (
  profile_id integer not null references idoc.profiles(id),
  expires_on date not null,
  first_observed_at timestamptz not null default now(),
  evidence_source varchar(40) not null default 'membership',
  primary key (profile_id, expires_on)
);
--> statement-breakpoint
create index if not exists membership_renewal_periods_expiration_idx
  on idoc.membership_renewal_periods (expires_on, profile_id);
--> statement-breakpoint
insert into idoc.membership_renewal_periods (profile_id, expires_on, evidence_source)
  select distinct m.profile_id, m.valid_until, 'migration_snapshot'
  from idoc.memberships m
  on conflict (profile_id, expires_on) do nothing;
--> statement-breakpoint
-- Existing queued/sent reminders carry the date in their stable dedupe key.
-- Recover those explicit historical expiration dates without guessing dates
-- from payment timestamps. Only parse keys that end in an ISO calendar date.
insert into idoc.membership_renewal_periods (profile_id, expires_on, evidence_source)
  select distinct o.profile_id, substring(o.dedupe_key from '([0-9]{4}-[0-9]{2}-[0-9]{2})$')::date,
    'reminder_dedupe_key'
  from idoc.notification_outbox o
  where o.profile_id is not null
    and o.kind in ('membership.renewal_reminder','membership.expiration_reminder','membership.grace_reminder')
    and o.dedupe_key ~ ':[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  on conflict (profile_id, expires_on) do nothing;
--> statement-breakpoint
create or replace function idoc.capture_membership_renewal_period()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.valid_until is distinct from new.valid_until then
    insert into idoc.membership_renewal_periods (profile_id, expires_on, evidence_source)
    values (old.profile_id, old.valid_until, 'previous_entitlement')
    on conflict (profile_id, expires_on) do nothing;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.valid_until is distinct from new.valid_until) then
    insert into idoc.membership_renewal_periods (profile_id, expires_on, evidence_source)
    values (new.profile_id, new.valid_until, 'entitlement_change')
    on conflict (profile_id, expires_on) do nothing;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger membership_renewal_period_capture
  after insert or update of valid_until on idoc.memberships
  for each row execute function idoc.capture_membership_renewal_period();

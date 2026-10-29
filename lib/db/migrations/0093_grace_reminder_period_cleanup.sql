-- Correct migration 0092's historical backfill: grace reminders use grace_ends_on,
-- which can be later than valid_until and is not itself a renewal period.
-- 0092 is already deployed to staging and remains immutable.
-- Remove only entries inferred solely from reminder dedupe keys that match
-- a grace-reminder date and have no independent renewal/expiration evidence.
delete from idoc.membership_renewal_periods p
where p.evidence_source = 'reminder_dedupe_key'
  and exists (
    select 1 from idoc.notification_outbox g
    where g.profile_id = p.profile_id
      and g.kind = 'membership.grace_reminder'
      and g.dedupe_key ~ ':[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and substring(g.dedupe_key from '([0-9]{4}-[0-9]{2}-[0-9]{2})$')::date = p.expires_on
  )
  and not exists (
    select 1 from idoc.memberships m
    where m.profile_id = p.profile_id and m.valid_until = p.expires_on
  )
  and not exists (
    select 1 from idoc.notification_outbox r
    where r.profile_id = p.profile_id
      and r.kind in ('membership.renewal_reminder', 'membership.expiration_reminder')
      and r.dedupe_key ~ ':[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and substring(r.dedupe_key from '([0-9]{4}-[0-9]{2}-[0-9]{2})$')::date = p.expires_on
  );

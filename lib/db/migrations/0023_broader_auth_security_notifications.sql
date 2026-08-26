alter table idoc.auth_security_notification_outbox
  add column if not exists recipient_email varchar(255),
  add column if not exists dedupe_key varchar(150);

update idoc.auth_security_notification_outbox o
set recipient_email = u.email
from idoc.users u
where u.id = o.user_id and o.recipient_email is null;

alter table idoc.auth_security_notification_outbox
  alter column recipient_email set not null;

alter table idoc.auth_security_notification_outbox
  drop constraint if exists auth_security_notification_kind_check;

alter table idoc.auth_security_notification_outbox
  add constraint auth_security_notification_kind_check check (kind in (
    'google_identity_linked', 'google_identity_unlinked', 'password_changed',
    'password_reset_completed', 'verified_email_changed', 'authenticator_enrolled',
    'authenticator_replaced', 'recovery_code_used', 'role_granted', 'role_revoked',
    'other_sessions_revoked'
  ));

create unique index if not exists auth_security_notification_dedupe_key_unique
  on idoc.auth_security_notification_outbox (dedupe_key)
  where dedupe_key is not null;

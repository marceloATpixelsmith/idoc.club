# Render schema separation — Next.js redesign only

Live WordPress at idoc.club is out of scope. The Next.js applications at redesign.idoc.club and staging.idoc.club currently share schema `idoc` in the Render database `ayni_space`. Target namespaces are `idoc_production` and `idoc_staging`.

This is a **preparation-only** change. Do not set DB_SCHEMA to either new schema yet, rename `idoc`, run a schema copy, or enable staging QStash scheduled jobs before the full audit, migration tooling, and tests are complete.

Required next phases in this same PR: update all ORM and schema-qualified SQL callsites; make DDL/migrations schema-aware; prepare backup + restore verification; handle triggers/functions/views/policies; rehearse schema rename; clone an internally consistent snapshot preserving data, FK constraints, sequence state, and migration history; quarantine staging sessions, account recovery, notification outboxes, and payment processing; verify no cross-schema SQL dependencies; coordinate deployment and then switch staging separately.

The existing Render connector exposes read-only SQL and cannot perform database DDL or backups. No database mutation has been performed.

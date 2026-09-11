ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "expected_amount_cents" integer;
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "currency" varchar(3) DEFAULT 'EUR' NOT NULL;
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "checkout_status" varchar(20);
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "checkout_created_at" timestamp with time zone;
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "payment_status_updated_at" timestamp with time zone;
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "disputed_at" timestamp with time zone;
ALTER TABLE "idoc"."seminar_registrations" ADD COLUMN "chargeback_at" timestamp with time zone;
ALTER TABLE "idoc"."seminar_registrations" DROP CONSTRAINT "seminar_registrations_payment_status_check";
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_payment_status_check" CHECK ("payment_status" in ('unpaid','pending','bank_transfer_pending','cash_pending','paid','refunded','partially_refunded','refund_failed','disputed','chargeback'));
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_expected_amount_check" CHECK ("expected_amount_cents" is null or "expected_amount_cents" >= 0);
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_currency_check" CHECK ("currency" = 'EUR');
ALTER TABLE "idoc"."seminar_registrations" ADD CONSTRAINT "seminar_registrations_checkout_status_check" CHECK ("checkout_status" is null or "checkout_status" in ('open','complete','expired','superseded'));
CREATE TABLE "idoc"."payment_refunds" (
 "id" serial PRIMARY KEY NOT NULL, "seminar_registration_id" integer CONSTRAINT "payment_refunds_seminar_registration_id_seminar_registrations_id_fk" REFERENCES "idoc"."seminar_registrations"("id"),
 "membership_payment_id" integer CONSTRAINT "payment_refunds_membership_payment_id_payments_id_fk" REFERENCES "idoc"."payments"("id"), "external_refund_id" varchar(255) CONSTRAINT "payment_refunds_external_refund_id_unique" UNIQUE,
 "idempotency_key" varchar(255) NOT NULL, "amount_cents" integer NOT NULL, "currency" varchar(3) DEFAULT 'EUR' NOT NULL,
 "status" varchar(30) NOT NULL, "reason" text NOT NULL, "administrator_id" integer CONSTRAINT "payment_refunds_administrator_id_users_id_fk" REFERENCES "idoc"."users"("id"),
 "failure_code" varchar(100), "provider_evidence" jsonb, "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
 "refunded_at" timestamp with time zone, "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "payment_refunds_idempotency_key_unique" UNIQUE ("idempotency_key"), CONSTRAINT "payment_refunds_owner_check" CHECK (num_nonnulls("seminar_registration_id","membership_payment_id") = 1),
 CONSTRAINT "payment_refunds_amount_check" CHECK ("amount_cents" > 0), CONSTRAINT "payment_refunds_currency_check" CHECK ("currency" = 'EUR'),
 CONSTRAINT "payment_refunds_status_check" CHECK ("status" in ('pending','succeeded','failed','canceled')));
CREATE UNIQUE INDEX "payment_refunds_one_pending_seminar" ON "idoc"."payment_refunds" ("seminar_registration_id") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "payment_refunds_one_pending_membership" ON "idoc"."payment_refunds" ("membership_payment_id") WHERE "status" = 'pending';
ALTER TABLE "idoc"."reconciliation_findings" DROP CONSTRAINT "reconciliation_findings_kind_check";
ALTER TABLE "idoc"."reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_kind_check" CHECK ("kind" in ('status_conflict','orphaned_subscription','repeated_failure','unlinked_customer','pending_schedule_conflict','refund_conflict','missing_refund','dispute','chargeback','seminar_payment_conflict'));

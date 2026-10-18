-- The "Missing refund" reconciliation type was reserved but never raised; remove it so the report only has types that can occur.
DELETE FROM "idoc"."reconciliation_ignores" WHERE "kind" = 'missing_refund';
--> statement-breakpoint
DELETE FROM "idoc"."reconciliation_findings" WHERE "kind" = 'missing_refund';
--> statement-breakpoint
ALTER TABLE "idoc"."reconciliation_findings" DROP CONSTRAINT IF EXISTS "reconciliation_findings_kind_check";
--> statement-breakpoint
ALTER TABLE "idoc"."reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_kind_check" CHECK ("idoc"."reconciliation_findings"."kind" in ('status_conflict', 'orphaned_subscription', 'repeated_failure', 'unlinked_customer', 'pending_schedule_conflict', 'refund_conflict', 'dispute', 'chargeback', 'seminar_payment_conflict'));

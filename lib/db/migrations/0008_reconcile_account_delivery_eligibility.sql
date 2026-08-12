ALTER TABLE "idoc"."account_delivery_outbox" ADD COLUMN IF NOT EXISTS "terminal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "idoc"."account_delivery_outbox" ADD COLUMN IF NOT EXISTS "terminal_reason" varchar(50);

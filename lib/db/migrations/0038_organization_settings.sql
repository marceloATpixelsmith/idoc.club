CREATE TABLE IF NOT EXISTS "idoc"."organization_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "address_1" varchar(200), "address_2" varchar(200), "city" varchar(100),
  "state_province" varchar(100), "postal_code" varchar(30), "country" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organization_settings_singleton_check" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idoc"."seminar_payment_methods" (
  "id" serial PRIMARY KEY NOT NULL, "canonical_id" varchar(40) NOT NULL,
  "display_label" varchar(100) NOT NULL, "enabled" boolean DEFAULT false NOT NULL,
  "system_protected" boolean DEFAULT false NOT NULL, "display_order" integer NOT NULL,
  "instructions_html" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "seminar_payment_methods_canonical_id_unique" UNIQUE("canonical_id"),
  CONSTRAINT "seminar_payment_methods_display_order_unique" UNIQUE("display_order"),
  CONSTRAINT "seminar_payment_methods_identity_check" CHECK ("canonical_id" in ('online_stripe','bank_transfer','cash_event')),
  CONSTRAINT "seminar_payment_methods_stripe_protected_check" CHECK ("canonical_id" <> 'online_stripe' OR ("enabled" AND "system_protected" AND "instructions_html" IS NULL))
);
--> statement-breakpoint
INSERT INTO "idoc"."organization_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "idoc"."seminar_payment_methods" ("canonical_id","display_label","enabled","system_protected","display_order") VALUES
 ('online_stripe','Online via Stripe',true,true,10),
 ('bank_transfer','Bank Transfer',false,false,20),
 ('cash_event','Cash at the Event',false,false,30)
ON CONFLICT ("canonical_id") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "idoc"."protect_canonical_seminar_payment_methods"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Canonical seminar payment methods must be deactivated, not deleted';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "seminar_payment_methods_no_delete" ON "idoc"."seminar_payment_methods";
--> statement-breakpoint
CREATE TRIGGER "seminar_payment_methods_no_delete" BEFORE DELETE ON "idoc"."seminar_payment_methods"
FOR EACH ROW EXECUTE FUNCTION "idoc"."protect_canonical_seminar_payment_methods"();

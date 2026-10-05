ALTER TABLE "idoc"."users" ADD COLUMN "legacy_profile_review_required" boolean DEFAULT false NOT NULL;
ALTER TABLE "idoc"."users" ADD COLUMN "legacy_profile_reviewed_at" timestamp with time zone;
ALTER TABLE "idoc"."users" ADD CONSTRAINT "users_legacy_profile_review_state_check"
  CHECK (NOT "legacy_profile_review_required" OR "legacy_profile_reviewed_at" IS NULL);
ALTER TABLE "idoc"."profiles" ALTER COLUMN "first_name" DROP NOT NULL;
ALTER TABLE "idoc"."profiles" ALTER COLUMN "last_name" DROP NOT NULL;
ALTER TABLE "idoc"."profiles" ALTER COLUMN "address_1" DROP NOT NULL;
ALTER TABLE "idoc"."profiles" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "idoc"."profiles" ALTER COLUMN "state_province" DROP NOT NULL;
ALTER TABLE "idoc"."profiles" ALTER COLUMN "postal_code" DROP NOT NULL;
ALTER TABLE "idoc"."profiles" ALTER COLUMN "country_code" DROP NOT NULL;

-- Import tooling, not this migration, explicitly marks every imported member. Existing native
-- accounts must remain unaffected. An authorized reset clears reviewed_at and sets required=true.

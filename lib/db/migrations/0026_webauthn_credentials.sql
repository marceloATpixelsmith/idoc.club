ALTER TABLE "idoc"."mfa_factors" DROP CONSTRAINT "mfa_factors_type_check";
--> statement-breakpoint
ALTER TABLE "idoc"."mfa_factors" ADD CONSTRAINT "mfa_factors_type_check" CHECK ("idoc"."mfa_factors"."factor_type" in ('totp', 'webauthn'));
--> statement-breakpoint
ALTER TABLE "idoc"."mfa_factors" ALTER COLUMN "encrypted_secret" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."mfa_factors" ALTER COLUMN "encryption_key_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "idoc"."mfa_factors" ADD CONSTRAINT "mfa_factors_totp_secret_check" CHECK (("idoc"."mfa_factors"."factor_type" = 'totp' and "idoc"."mfa_factors"."encrypted_secret" is not null and "idoc"."mfa_factors"."encryption_key_id" is not null) or ("idoc"."mfa_factors"."factor_type" = 'webauthn' and "idoc"."mfa_factors"."encrypted_secret" is null and "idoc"."mfa_factors"."encryption_key_id" is null));
--> statement-breakpoint
DROP INDEX "idoc"."mfa_factors_one_active_totp";
--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_factors_one_active_totp" ON "idoc"."mfa_factors" USING btree ("user_id","application_id","factor_type") WHERE "idoc"."mfa_factors"."status" = 'active' and "idoc"."mfa_factors"."factor_type" = 'totp';
--> statement-breakpoint
CREATE TABLE "idoc"."webauthn_credentials" (
  "credential_id" varchar(255) PRIMARY KEY NOT NULL,
  "factor_id" varchar(36) NOT NULL,
  "user_id" integer NOT NULL,
  "application_id" varchar(100) NOT NULL,
  "public_key" text NOT NULL,
  "sign_count" integer DEFAULT 0 NOT NULL,
  "transports" varchar(200),
  "device_type" varchar(20) NOT NULL,
  "backed_up" boolean NOT NULL,
  "device_name" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  CONSTRAINT "webauthn_credentials_device_type_check" CHECK ("idoc"."webauthn_credentials"."device_type" in ('singleDevice', 'multiDevice')),
  CONSTRAINT "webauthn_credentials_factor_id_mfa_factors_factor_id_fk" FOREIGN KEY ("factor_id") REFERENCES "idoc"."mfa_factors"("factor_id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_credentials_factor_unique" ON "idoc"."webauthn_credentials" USING btree ("factor_id");
--> statement-breakpoint
CREATE INDEX "webauthn_credentials_owner_idx" ON "idoc"."webauthn_credentials" USING btree ("user_id","application_id");
--> statement-breakpoint
CREATE TABLE "idoc"."webauthn_ceremony_challenges" (
  "ceremony_id" varchar(36) PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "application_id" varchar(100) NOT NULL,
  "purpose" varchar(20) NOT NULL,
  "challenge" varchar(255) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webauthn_ceremony_purpose_check" CHECK ("idoc"."webauthn_ceremony_challenges"."purpose" in ('registration', 'authentication')),
  CONSTRAINT "webauthn_ceremony_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "webauthn_ceremony_owner_idx" ON "idoc"."webauthn_ceremony_challenges" USING btree ("user_id","application_id","expires_at");

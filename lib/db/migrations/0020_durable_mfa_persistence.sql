CREATE TABLE "idoc"."mfa_factors" (
  "factor_id" varchar(36) PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "application_id" varchar(100) NOT NULL,
  "factor_type" varchar(20) DEFAULT 'totp' NOT NULL,
  "status" varchar(20) NOT NULL,
  "encrypted_secret" text NOT NULL,
  "encryption_key_id" varchar(100) NOT NULL,
  "last_accepted_counter" integer,
  "activated_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "lifecycle_reason" varchar(200),
  "replaced_by_factor_id" varchar(36),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mfa_factors_type_check" CHECK ("idoc"."mfa_factors"."factor_type" in ('totp')),
  CONSTRAINT "mfa_factors_status_check" CHECK ("idoc"."mfa_factors"."status" in ('pending', 'active', 'disabled', 'revoked', 'replaced')),
  CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_factors_one_active_totp" ON "idoc"."mfa_factors" USING btree ("user_id","application_id","factor_type") WHERE "idoc"."mfa_factors"."status" = 'active';
--> statement-breakpoint
CREATE INDEX "mfa_factors_owner_idx" ON "idoc"."mfa_factors" USING btree ("user_id","application_id");
--> statement-breakpoint
CREATE TABLE "idoc"."mfa_enrollment_transactions" (
  "transaction_id" varchar(36) PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "application_id" varchar(100) NOT NULL,
  "factor_id" varchar(36) NOT NULL,
  "purpose" varchar(40) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mfa_enrollment_purpose_check" CHECK ("idoc"."mfa_enrollment_transactions"."purpose" in ('mfa-enrollment', 'authenticator-replacement', 'mfa-recovery')),
  CONSTRAINT "mfa_enrollment_attempt_count_check" CHECK ("idoc"."mfa_enrollment_transactions"."attempt_count" >= 0),
  CONSTRAINT "mfa_enrollment_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "mfa_enrollment_transactions_factor_id_mfa_factors_factor_id_fk" FOREIGN KEY ("factor_id") REFERENCES "idoc"."mfa_factors"("factor_id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "mfa_enrollment_owner_idx" ON "idoc"."mfa_enrollment_transactions" USING btree ("user_id","application_id","expires_at");
--> statement-breakpoint
CREATE TABLE "idoc"."mfa_challenge_transactions" (
  "transaction_id" varchar(36) PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "application_id" varchar(100) NOT NULL,
  "purpose" varchar(20) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer NOT NULL,
  "consumed_at" timestamp with time zone,
  "satisfied_factor_id" varchar(36),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mfa_challenge_purpose_check" CHECK ("idoc"."mfa_challenge_transactions"."purpose" in ('login', 'step-up')),
  CONSTRAINT "mfa_challenge_attempts_check" CHECK ("idoc"."mfa_challenge_transactions"."attempt_count" >= 0 and "idoc"."mfa_challenge_transactions"."max_attempts" > 0 and "idoc"."mfa_challenge_transactions"."attempt_count" <= "idoc"."mfa_challenge_transactions"."max_attempts"),
  CONSTRAINT "mfa_challenge_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "mfa_challenge_transactions_satisfied_factor_id_mfa_factors_factor_id_fk" FOREIGN KEY ("satisfied_factor_id") REFERENCES "idoc"."mfa_factors"("factor_id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "mfa_challenge_owner_idx" ON "idoc"."mfa_challenge_transactions" USING btree ("user_id","application_id","expires_at");
--> statement-breakpoint
CREATE TABLE "idoc"."mfa_recovery_codes" (
  "recovery_code_id" varchar(36) PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "application_id" varchar(100) NOT NULL,
  "generation_id" varchar(36) NOT NULL,
  "digest" varchar(64) NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_recovery_codes_digest_unique" ON "idoc"."mfa_recovery_codes" USING btree ("user_id","application_id","digest");
--> statement-breakpoint
CREATE INDEX "mfa_recovery_codes_generation_idx" ON "idoc"."mfa_recovery_codes" USING btree ("user_id","application_id","generation_id");
--> statement-breakpoint
CREATE TABLE "idoc"."mfa_remembered_devices" (
  "remembered_device_id" varchar(36) PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "application_id" varchar(100) NOT NULL,
  "factor_id" varchar(36) NOT NULL,
  "token_digest" varchar(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoke_reason" varchar(200),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mfa_remembered_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "mfa_remembered_devices_factor_id_mfa_factors_factor_id_fk" FOREIGN KEY ("factor_id") REFERENCES "idoc"."mfa_factors"("factor_id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_remembered_devices_digest_unique" ON "idoc"."mfa_remembered_devices" USING btree ("token_digest");
--> statement-breakpoint
CREATE INDEX "mfa_remembered_devices_owner_idx" ON "idoc"."mfa_remembered_devices" USING btree ("user_id","application_id","expires_at");

CREATE TABLE "idoc"."email_otp_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"email" varchar(255) NOT NULL,
	"purpose" varchar(30) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_otp_codes_purpose_check" CHECK ("idoc"."email_otp_codes"."purpose" in ('signup_verification', 'login_verification', 'password_reset'))
);
--> statement-breakpoint
ALTER TABLE "idoc"."email_otp_codes" ADD CONSTRAINT "email_otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "idoc"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_otp_codes_lookup_idx" ON "idoc"."email_otp_codes" USING btree ("email","purpose","expires_at") WHERE "idoc"."email_otp_codes"."consumed_at" is null;
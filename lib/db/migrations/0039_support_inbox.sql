CREATE TABLE "idoc"."support_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"member_user_id" integer NOT NULL,
	"category" varchar(30) NOT NULL,
	"subject" varchar(160) NOT NULL,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"assigned_admin_user_id" integer,
	"member_read_at" timestamp with time zone,
	"admin_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_conversations_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "support_conversations_category_check" CHECK ("category" in ('billing_membership', 'seminars', 'technical_support')),
	CONSTRAINT "support_conversations_status_check" CHECK ("status" in ('open', 'admin_responded', 'member_replied', 'closed')),
	CONSTRAINT "support_conversations_subject_length_check" CHECK (char_length("subject") between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "idoc"."support_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"author_user_id" integer NOT NULL,
	"author_side" varchar(10) NOT NULL,
	"body" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_messages_author_side_check" CHECK ("author_side" in ('member', 'admin')),
	CONSTRAINT "support_messages_body_length_check" CHECK (char_length("body") between 1 and 10000),
	CONSTRAINT "support_messages_author_idempotency_unique" UNIQUE("author_user_id", "idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "idoc"."support_category_defaults" (
	"category" varchar(30) PRIMARY KEY NOT NULL,
	"administrator_user_id" integer NOT NULL,
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_category_defaults_category_check" CHECK ("category" in ('billing_membership', 'seminars', 'technical_support'))
);
--> statement-breakpoint
ALTER TABLE "idoc"."support_conversations" ADD CONSTRAINT "support_conversations_member_user_id_users_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "idoc"."users"("id");
ALTER TABLE "idoc"."support_conversations" ADD CONSTRAINT "support_conversations_assigned_admin_user_id_users_id_fk" FOREIGN KEY ("assigned_admin_user_id") REFERENCES "idoc"."users"("id");
ALTER TABLE "idoc"."support_messages" ADD CONSTRAINT "support_messages_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "idoc"."support_conversations"("id");
ALTER TABLE "idoc"."support_messages" ADD CONSTRAINT "support_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "idoc"."users"("id");
ALTER TABLE "idoc"."support_category_defaults" ADD CONSTRAINT "support_category_defaults_administrator_user_id_users_id_fk" FOREIGN KEY ("administrator_user_id") REFERENCES "idoc"."users"("id");
ALTER TABLE "idoc"."support_category_defaults" ADD CONSTRAINT "support_category_defaults_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "idoc"."users"("id");
CREATE INDEX "support_conversations_member_activity_idx" ON "idoc"."support_conversations" ("member_user_id", "updated_at");
CREATE INDEX "support_conversations_admin_queue_idx" ON "idoc"."support_conversations" ("assigned_admin_user_id", "status", "updated_at");
CREATE INDEX "support_messages_thread_idx" ON "idoc"."support_messages" ("conversation_id", "created_at", "id");
CREATE TRIGGER "support_messages_immutable" BEFORE UPDATE OR DELETE ON "idoc"."support_messages" FOR EACH ROW EXECUTE FUNCTION "idoc"."reject_immutable_history_change"();

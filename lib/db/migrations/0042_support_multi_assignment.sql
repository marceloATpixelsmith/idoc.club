CREATE TABLE "idoc"."support_conversation_administrators" (
  "conversation_id" integer NOT NULL,
  "administrator_user_id" integer NOT NULL,
  "assigned_by_user_id" integer,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "support_conversation_administrators_conversation_id_administrator_user_id_pk" PRIMARY KEY("conversation_id","administrator_user_id")
);
--> statement-breakpoint
CREATE TABLE "idoc"."support_administrator_read_cursors" (
  "conversation_id" integer NOT NULL,
  "administrator_user_id" integer NOT NULL,
  "read_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "support_administrator_read_cursors_conversation_id_administrator_user_id_pk" PRIMARY KEY("conversation_id","administrator_user_id")
);
--> statement-breakpoint
ALTER TABLE "idoc"."support_conversation_administrators" ADD CONSTRAINT "support_conversation_administrators_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "idoc"."support_conversations"("id");
ALTER TABLE "idoc"."support_conversation_administrators" ADD CONSTRAINT "support_conversation_administrators_administrator_user_id_users_id_fk" FOREIGN KEY ("administrator_user_id") REFERENCES "idoc"."users"("id");
ALTER TABLE "idoc"."support_conversation_administrators" ADD CONSTRAINT "support_conversation_administrators_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "idoc"."users"("id");
ALTER TABLE "idoc"."support_administrator_read_cursors" ADD CONSTRAINT "support_administrator_read_cursors_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "idoc"."support_conversations"("id");
ALTER TABLE "idoc"."support_administrator_read_cursors" ADD CONSTRAINT "support_administrator_read_cursors_administrator_user_id_users_id_fk" FOREIGN KEY ("administrator_user_id") REFERENCES "idoc"."users"("id");
CREATE INDEX "support_conversation_administrators_admin_idx" ON "idoc"."support_conversation_administrators" ("administrator_user_id","conversation_id");
INSERT INTO "idoc"."support_conversation_administrators" ("conversation_id","administrator_user_id") SELECT "id","assigned_admin_user_id" FROM "idoc"."support_conversations" WHERE "assigned_admin_user_id" IS NOT NULL ON CONFLICT DO NOTHING;

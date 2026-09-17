CREATE INDEX "audit_log_actor_activity_idx" ON "idoc"."audit_log" USING btree ("actor_id","created_at");

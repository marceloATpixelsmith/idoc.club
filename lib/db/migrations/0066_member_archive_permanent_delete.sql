ALTER TABLE "idoc"."audit_log" DROP CONSTRAINT "audit_log_actor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "idoc"."audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "idoc"."users"("id") ON DELETE SET NULL ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "idoc"."reject_immutable_history_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('idoc.allow_member_permanent_delete', true) = 'on' THEN
    IF TG_TABLE_NAME = 'audit_log' AND TG_OP = 'UPDATE'
      AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
      AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME IN ('profile_change_history', 'support_messages') AND TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'IDOC history records are immutable';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "idoc"."reject_support_message_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('idoc.allow_member_permanent_delete', true) = 'on' AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Support messages are immutable';
END;
$$;

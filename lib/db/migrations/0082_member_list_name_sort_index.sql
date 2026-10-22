-- Serves the administrator Members roster's default Name sort (last name, first name, then profile id) so the first page is read
-- off the index instead of sorting every matching member. Additive and expand-only: an older build keeps working without it.
CREATE INDEX IF NOT EXISTS "profiles_name_sort_idx" ON "idoc"."profiles" USING btree ("last_name","first_name","id");

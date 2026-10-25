alter table idoc.administrator_table_preferences
  drop constraint if exists administrator_table_preferences_identifier_check;
--> statement-breakpoint
alter table idoc.administrator_table_preferences
  add constraint administrator_table_preferences_identifier_check
  check (table_identifier in ('memberships', 'support', 'news', 'seminars', 'seminar_registrations', 'member_timeline'));

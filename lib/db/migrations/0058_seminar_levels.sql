-- Adds the FEI/officiating level(s) a seminar applies to. A plain varchar[] defaulting to '{}' (no
-- existing seminar claims any level on backfill) rather than an enum table, since the only shapes
-- this ever needs are "one or more of level_1/level_2/level_3" or the single special value
-- all_levels -- enforced with a check constraint instead of a join.
ALTER TABLE "idoc"."seminars" ADD COLUMN "levels" varchar(20)[] DEFAULT '{}'::varchar(20)[] NOT NULL;
ALTER TABLE "idoc"."seminars" ADD CONSTRAINT "seminars_levels_valid_check" CHECK ("levels" <@ ARRAY['level_1','level_2','level_3','all_levels']::varchar(20)[]);

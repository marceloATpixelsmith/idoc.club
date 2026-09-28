-- Adds the FEI/officiating level(s) a seminar applies to. A plain varchar[] defaulting to '{}' (no
-- existing seminar claims any level on backfill) rather than an enum table, since the only shapes
-- this ever needs are "one or more of level_1/level_2/level_3" or the single special value
-- all_levels -- enforced with a check constraint instead of a join. The check also rejects
-- all_levels appearing alongside any other value, so a write that bypasses parseLevels (a manual
-- repair, a future import) can never persist the contradictory ['all_levels', 'level_1'].
ALTER TABLE "idoc"."seminars" ADD COLUMN "levels" varchar(20)[] DEFAULT '{}'::varchar(20)[] NOT NULL;
ALTER TABLE "idoc"."seminars" ADD CONSTRAINT "seminars_levels_valid_check" CHECK ("levels" <@ ARRAY['level_1','level_2','level_3','all_levels']::varchar(20)[] and (not ('all_levels' = any("levels")) or cardinality("levels") = 1));

-- This migration also retires time-of-day everywhere seminars are authored or displayed
-- (lib/seminars/seminars.ts's FIXED_START_TIME/FIXED_END_TIME). Every existing seminar --
-- including the legacy WordPress import's arbitrary 09:00-17:00 default -- still carries a real
-- start_time/end_time from before this change; left alone, listCurrentSeminarsForMember and the
-- registration-open check (which compare against end_date + end_time) would keep silently cutting
-- a same-day seminar off at its old, no-longer-displayed end time instead of end of day. Backfilling
-- every row to the same 00:00/23:59 anchor newly-created seminars get keeps availability and
-- deadline-ordering behavior consistent with the date-only UI for every seminar, not just future ones.
UPDATE "idoc"."seminars" SET "start_time" = '00:00:00', "end_time" = '23:59:00';

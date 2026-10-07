ALTER TABLE "idoc"."profiles"
  ADD COLUMN IF NOT EXISTS "is_board_member" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "board_title" varchar(120),
  ADD COLUMN IF NOT EXISTS "board_subtitle" varchar(160),
  ADD COLUMN IF NOT EXISTS "board_facebook_url" varchar(500),
  ADD COLUMN IF NOT EXISTS "board_photo_url" text;

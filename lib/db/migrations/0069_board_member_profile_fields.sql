ALTER TABLE "idoc"."profiles"
  ADD COLUMN IF NOT EXISTS "is_board_member" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "board_title" varchar(120),
  ADD COLUMN IF NOT EXISTS "board_subtitle" varchar(160),
  ADD COLUMN IF NOT EXISTS "board_facebook_url" varchar(500),
  ADD COLUMN IF NOT EXISTS "board_photo_url" text;
--> statement-breakpoint

UPDATE "idoc"."profiles"
SET
  "is_board_member" = true,
  "board_title" = CASE lower("last_name")
    WHEN 'matthiesen' THEN 'IDOC President'
    WHEN 'foy' THEN '1st Vice-President'
    WHEN 'shivdas' THEN '2nd Vice-President'
    WHEN 'leao' THEN 'Secretary'
    WHEN 'saleh' THEN 'Western Europe & Africa representative'
    WHEN 'zayrik' THEN 'Latin & South America representative'
    WHEN 'hillier' THEN 'Eastern & Central Europe representative'
    WHEN 'hoevenaars' THEN 'Australia & Pacific region representative'
    WHEN 'verbocht' THEN 'Treasurer'
    WHEN 'widalska' THEN 'Steward'
    WHEN 'gorretta' THEN 'Steward'
    WHEN 'orsini' THEN 'Para Dressage representative'
    ELSE "board_title"
  END,
  "board_subtitle" = CASE lower("last_name")
    WHEN 'shivdas' THEN 'Asian representative'
    WHEN 'widalska' THEN 'Steward representative'
    WHEN 'gorretta' THEN 'Steward representative'
    ELSE NULL
  END,
  "board_facebook_url" = CASE lower("last_name")
    WHEN 'matthiesen' THEN 'https://www.facebook.com/hanschristian.matthiesen'
    WHEN 'foy' THEN 'https://www.facebook.com/janet.foy.14'
    WHEN 'shivdas' THEN 'https://www.facebook.com/profile.php?id=100017773665966'
    WHEN 'leao' THEN 'https://www.facebook.com/alexandre.leao'
    WHEN 'saleh' THEN 'https://www.facebook.com/raphael.saleh'
    WHEN 'zayrik' THEN 'https://www.facebook.com/ozayrik'
    WHEN 'hillier' THEN 'https://www.facebook.com/orsolya.hillier'
    WHEN 'hoevenaars' THEN 'https://www.facebook.com/susan.hoevenaars.7'
    WHEN 'verbocht' THEN 'https://www.facebook.com/profile.php?id=100018976443615'
    WHEN 'widalska' THEN 'https://www.facebook.com/kasia.basia.7'
    WHEN 'gorretta' THEN 'https://www.facebook.com/lisa.gorretta/photos'
    ELSE NULL
  END,
  "board_photo_url" = CASE lower("last_name")
    WHEN 'matthiesen' THEN '/board/hans.jpeg'
    WHEN 'foy' THEN '/board/janet.jpeg'
    WHEN 'shivdas' THEN '/board/sunil.jpeg'
    WHEN 'leao' THEN '/board/alexandre.jpeg'
    WHEN 'saleh' THEN '/board/raphael.jpeg'
    WHEN 'zayrik' THEN '/board/omar.jpeg'
    WHEN 'hillier' THEN '/board/orsolya.jpeg'
    WHEN 'hoevenaars' THEN '/board/susan.png'
    WHEN 'verbocht' THEN '/board/luc.jpeg'
    WHEN 'widalska' THEN '/board/katarzyna.jpeg'
    WHEN 'gorretta' THEN '/board/lisa.jpg'
    WHEN 'orsini' THEN '/board/marco.jpeg'
    ELSE "board_photo_url"
  END
WHERE lower("last_name") IN (
  'matthiesen','foy','shivdas','leao','saleh','zayrik',
  'hillier','hoevenaars','verbocht','widalska','gorretta','orsini'
);

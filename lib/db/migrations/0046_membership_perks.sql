CREATE TABLE "idoc"."membership_perks" (
  "id" serial PRIMARY KEY NOT NULL,
  "label" varchar(200) NOT NULL,
  "display_order" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "membership_perks_label_length_check" CHECK (char_length("idoc"."membership_perks"."label") between 1 and 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "membership_perks_display_order_unique" ON "idoc"."membership_perks" USING btree ("display_order");
--> statement-breakpoint
INSERT INTO "idoc"."membership_perks" ("label","display_order") VALUES
 ('Member area access',10),
 ('Seminar priority information',20),
 ('IDOC documents & GA papers',30),
 ('Officials'' directory',40);

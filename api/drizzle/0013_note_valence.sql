ALTER TABLE "notes" ADD COLUMN "valence" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "historical" boolean DEFAULT false NOT NULL;
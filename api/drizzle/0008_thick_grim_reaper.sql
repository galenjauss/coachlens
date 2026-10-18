ALTER TABLE "decks" ADD COLUMN "is_starter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "last_attempt_at" timestamp with time zone;
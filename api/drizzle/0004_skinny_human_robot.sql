CREATE TABLE "llm_usage" (
	"day" text PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "mode" text DEFAULT 'martial_arts' NOT NULL;--> statement-breakpoint
ALTER TABLE "curriculum" ADD COLUMN "mode" text DEFAULT 'martial_arts' NOT NULL;--> statement-breakpoint
ALTER TABLE "curriculum" DROP CONSTRAINT "curriculum_pkey";--> statement-breakpoint
ALTER TABLE "curriculum" ADD CONSTRAINT "curriculum_week_start_mode_pk" PRIMARY KEY("week_start","mode");

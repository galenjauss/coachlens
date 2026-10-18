CREATE TABLE "llm_usage_instructor" (
	"instructor_id" text NOT NULL,
	"day" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "llm_usage_instructor_instructor_id_day_pk" PRIMARY KEY("instructor_id","day")
);
--> statement-breakpoint
CREATE TABLE "pair_attempts" (
	"bucket" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);

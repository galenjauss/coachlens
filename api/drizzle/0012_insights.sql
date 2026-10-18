CREATE TABLE "insights" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"student_id" text,
	"class_id" text,
	"session_id" text,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"urgency" text NOT NULL,
	"action" jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"outcome" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "insights_dedupe_key" ON "insights" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "insights_status_created" ON "insights" USING btree ("status","created_at");
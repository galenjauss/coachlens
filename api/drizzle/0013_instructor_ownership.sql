CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"instructor_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "instructor_curriculum" (
	"instructor_id" text NOT NULL,
	"week_start" text NOT NULL,
	"mode" text NOT NULL,
	"theme" text NOT NULL,
	"forms_due" jsonb NOT NULL,
	CONSTRAINT "instructor_curriculum_instructor_id_week_start_mode_pk" PRIMARY KEY("instructor_id","week_start","mode")
);
--> statement-breakpoint
CREATE TABLE "instructor_settings" (
	"instructor_id" text NOT NULL,
	"task" text NOT NULL,
	"autonomy" text NOT NULL,
	CONSTRAINT "instructor_settings_instructor_id_task_pk" PRIMARY KEY("instructor_id","task")
);
--> statement-breakpoint
CREATE TABLE "instructor_vocab" (
	"instructor_id" text NOT NULL,
	"term" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instructor_vocab_instructor_id_term_pk" PRIMARY KEY("instructor_id","term")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "instructor_id" text;--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "pairing_code_hash" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "instructor_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_instructor" ON "api_tokens" USING btree ("instructor_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_instructor_created" ON "agent_runs" USING btree ("instructor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "instructors_pairing_code_hash" ON "instructors" USING btree ("pairing_code_hash");--> statement-breakpoint
CREATE INDEX "students_instructor" ON "students" USING btree ("instructor_id");--> statement-breakpoint
-- Backfill (C4). Existing paired phones keep working for 90 days from this migration.
INSERT INTO "api_tokens" ("id", "instructor_id", "token_hash", "expires_at")
SELECT md5(i."id" || h.value), i."id", h.value, now() + interval '90 days'
FROM "instructors" i, jsonb_array_elements_text(i."token_hashes") AS h(value)
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "students" s SET "instructor_id" = (
  SELECT min(c."instructor_id") FROM "enrollments" e JOIN "classes" c ON c."id" = e."class_id" WHERE e."student_id" = s."id"
) WHERE s."instructor_id" IS NULL;--> statement-breakpoint
UPDATE "agent_runs" r SET "instructor_id" = c."instructor_id"
FROM "sessions" se JOIN "classes" c ON c."id" = se."class_id"
WHERE r."instructor_id" IS NULL AND r."session_id" = se."id";--> statement-breakpoint
-- Rows with no path to an owner are attributed only when the deployment has exactly one instructor (the demo).
UPDATE "students" SET "instructor_id" = (SELECT min("id") FROM "instructors")
WHERE "instructor_id" IS NULL AND (SELECT count(*) FROM "instructors") = 1;--> statement-breakpoint
UPDATE "agent_runs" SET "instructor_id" = (SELECT min("id") FROM "instructors")
WHERE "instructor_id" IS NULL AND (SELECT count(*) FROM "instructors") = 1;--> statement-breakpoint
INSERT INTO "instructor_settings" ("instructor_id", "task", "autonomy")
SELECT i."id", s."task", s."autonomy" FROM "instructors" i, "agent_settings" s ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "instructor_vocab" ("instructor_id", "term", "created_at")
SELECT i."id", v."term", v."created_at" FROM "instructors" i, "school_vocab" v ON CONFLICT DO NOTHING;

CREATE TABLE "action_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"utterance_id" text NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"instructor_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deferred_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"utterance_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
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
CREATE TABLE "operations" (
	"instructor_id" text NOT NULL,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_instructor_id_key_pk" PRIMARY KEY("instructor_id","key")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "instructor_id" text;--> statement-breakpoint
ALTER TABLE "deck_diffs" ADD COLUMN "utterance_id" text;--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "pairing_code_hash" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "utterance_id" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "instructor_id" text;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "action_ledger_utterance" ON "action_ledger" USING btree ("utterance_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_instructor" ON "api_tokens" USING btree ("instructor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deferred_tasks_once" ON "deferred_tasks" USING btree ("utterance_id","kind","subject");--> statement-breakpoint
CREATE INDEX "agent_runs_instructor_created" ON "agent_runs" USING btree ("instructor_id","created_at");--> statement-breakpoint
CREATE INDEX "deck_diffs_utterance" ON "deck_diffs" USING btree ("utterance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instructors_pairing_code_hash" ON "instructors" USING btree ("pairing_code_hash");--> statement-breakpoint
CREATE INDEX "outbox_utterance" ON "outbox" USING btree ("utterance_id");--> statement-breakpoint
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
--> statement-breakpoint
-- Backfill (C2): existing drafts and plan diffs are linked to their utterance through the agent run that made them.
UPDATE "outbox" o SET "utterance_id" = r."utterance_id" FROM "agent_runs" r
WHERE o."utterance_id" IS NULL AND r."utterance_id" IS NOT NULL AND r."links"->>'outboxId' = o."id";--> statement-breakpoint
UPDATE "deck_diffs" d SET "utterance_id" = r."utterance_id" FROM "agent_runs" r
WHERE d."utterance_id" IS NULL AND r."utterance_id" IS NOT NULL AND r."links"->>'diffId' = d."id";

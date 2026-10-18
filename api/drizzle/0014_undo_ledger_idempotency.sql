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
ALTER TABLE "deck_diffs" ADD COLUMN "utterance_id" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "utterance_id" text;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "action_ledger_utterance" ON "action_ledger" USING btree ("utterance_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deferred_tasks_once" ON "deferred_tasks" USING btree ("utterance_id","kind","subject");--> statement-breakpoint
CREATE INDEX "deck_diffs_utterance" ON "deck_diffs" USING btree ("utterance_id");--> statement-breakpoint
CREATE INDEX "outbox_utterance" ON "outbox" USING btree ("utterance_id");--> statement-breakpoint
-- Backfill (C2): existing drafts and plan diffs are linked to their utterance through the agent run that made them.
UPDATE "outbox" o SET "utterance_id" = r."utterance_id" FROM "agent_runs" r
WHERE o."utterance_id" IS NULL AND r."utterance_id" IS NOT NULL AND r."links"->>'outboxId' = o."id";--> statement-breakpoint
UPDATE "deck_diffs" d SET "utterance_id" = r."utterance_id" FROM "agent_runs" r
WHERE d."utterance_id" IS NULL AND r."utterance_id" IS NOT NULL AND r."links"->>'diffId' = d."id";

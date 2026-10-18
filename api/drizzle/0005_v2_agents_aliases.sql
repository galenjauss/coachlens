ALTER TABLE "agent_runs" ADD COLUMN "utterance_id" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "links" jsonb;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "trigger" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_runs_utterance" ON "agent_runs" USING btree ("utterance_id");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_created" ON "agent_runs" USING btree ("agent","created_at");
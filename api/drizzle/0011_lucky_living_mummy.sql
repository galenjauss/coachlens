CREATE TABLE "student_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"num" double precision,
	"unit" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"utterance_id" text
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "rank_since" date;--> statement-breakpoint
CREATE INDEX "student_metrics_student_key" ON "student_metrics" USING btree ("student_id","key","recorded_at");
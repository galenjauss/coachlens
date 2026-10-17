CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"agent" text NOT NULL,
	"trigger" text NOT NULL,
	"summary" text NOT NULL,
	"reason" text NOT NULL,
	"output" jsonb,
	"status" text NOT NULL,
	"ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"session_id" text NOT NULL,
	"student_id" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "attendance_session_id_student_id_pk" PRIMARY KEY("session_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "billing_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text,
	"utterance_id" text,
	"urgency" text NOT NULL,
	"note" text NOT NULL,
	"amount" real,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" text PRIMARY KEY NOT NULL,
	"instructor_id" text NOT NULL,
	"name" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"remind_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum" (
	"week_start" text PRIMARY KEY NOT NULL,
	"theme" text NOT NULL,
	"forms_due" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deck_diffs" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"request_text" text NOT NULL,
	"diff" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"for_date" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drills" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"minutes" integer NOT NULL,
	"kind" text NOT NULL,
	"cues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"focus_student_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"class_id" text NOT NULL,
	"student_id" text NOT NULL,
	CONSTRAINT "enrollments_class_id_student_id_pk" PRIMARY KEY("class_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"tag" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"utterance_id" text,
	"student_id" text,
	"heard" text,
	"drill_id" text,
	"text" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"student_id" text NOT NULL,
	"session_id" text,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"month" text NOT NULL,
	"content" jsonb NOT NULL,
	"outbox_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"deck_id" text NOT NULL,
	"for_date" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"remind_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"nickname" text,
	"belt" text NOT NULL,
	"birth_year" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "utterances" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"transcript" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

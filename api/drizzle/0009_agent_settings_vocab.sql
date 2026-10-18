CREATE TABLE "agent_settings" (
	"task" text PRIMARY KEY NOT NULL,
	"autonomy" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_vocab" (
	"term" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

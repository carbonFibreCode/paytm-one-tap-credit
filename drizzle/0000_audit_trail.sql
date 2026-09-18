CREATE TYPE "public"."nudge_outcome" AS ENUM('shown', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."served_by" AS ENUM('n8n', 'direct');--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_key" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text,
	"amount" integer,
	"merchant_name" text,
	"merchant_category" text,
	"requested_at" timestamp with time zone NOT NULL,
	"show_nudge" boolean,
	"product" text,
	"score" integer,
	"eligibility_signal" integer,
	"blocked_by" text,
	"blocked_reason" text,
	"served_by" "served_by",
	"latency_ms" integer,
	"trace" jsonb,
	"engine_version" text
);
--> statement-breakpoint
CREATE TABLE "nudge_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid,
	"decision_key" text NOT NULL,
	"user_id" text NOT NULL,
	"product" text,
	"outcome" "nudge_outcome" NOT NULL,
	"merchant_category" text,
	"nudge_source" text,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nudge_events" ADD CONSTRAINT "nudge_events_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_user_requested_idx" ON "decisions" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX "decisions_blocked_by_idx" ON "decisions" USING btree ("blocked_by");--> statement-breakpoint
CREATE INDEX "decisions_key_idx" ON "decisions" USING btree ("decision_key");--> statement-breakpoint
CREATE INDEX "nudge_events_user_occurred_idx" ON "nudge_events" USING btree ("user_id","occurred_at");
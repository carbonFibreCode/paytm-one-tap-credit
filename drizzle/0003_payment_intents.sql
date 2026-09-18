CREATE TYPE "public"."intent_kind" AS ENUM('static', 'dynamic');--> statement-breakpoint
CREATE TYPE "public"."intent_status" AS ENUM('created', 'scanned', 'paid', 'expired');--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"merchant_id" text NOT NULL,
	"vpa" text NOT NULL,
	"mcc" text NOT NULL,
	"kind" "intent_kind" NOT NULL,
	"amount" integer,
	"currency" text DEFAULT 'INR' NOT NULL,
	"payload" text NOT NULL,
	"signature" text NOT NULL,
	"status" "intent_status" DEFAULT 'created' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"scanned_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"decision_key" text,
	CONSTRAINT "payment_intents_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "intent_ref" text;--> statement-breakpoint
CREATE INDEX "payment_intents_merchant_kind_idx" ON "payment_intents" USING btree ("merchant_id","kind");
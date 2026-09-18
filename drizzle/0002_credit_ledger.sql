CREATE TYPE "public"."account_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."credit_product" AS ENUM('postpaid', 'card');--> statement-breakpoint
CREATE TYPE "public"."installment_status" AS ENUM('due', 'paid', 'late');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('upi', 'wallet', 'postpaid', 'card');--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"product" "credit_product" NOT NULL,
	"partner" text NOT NULL,
	"principal" integer NOT NULL,
	"tenure_months" integer NOT NULL,
	"interest" integer DEFAULT 0 NOT NULL,
	"no_cost" boolean DEFAULT false NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emi_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount" integer NOT NULL,
	"status" "installment_status" DEFAULT 'due' NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "emi_installments_account_seq" UNIQUE("account_id","seq")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"merchant_name" text NOT NULL,
	"decision_key" text,
	"amount" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"partner" text,
	"paid_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emi_installments" ADD CONSTRAINT "emi_installments_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_accounts_user_status_idx" ON "credit_accounts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "payments_user_paid_idx" ON "payments" USING btree ("user_id","paid_at");
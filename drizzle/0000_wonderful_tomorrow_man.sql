CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"contract_id" uuid,
	"event_type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"alert_type" text NOT NULL,
	"scheduled_for" date NOT NULL,
	"target_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"created_by" uuid,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"analysis_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"parent_contract_id" uuid NOT NULL,
	"created_by" uuid,
	"field_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"clause_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"model" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_comparisons_contract_id_unique" UNIQUE("contract_id")
);
--> statement-breakpoint
CREATE TABLE "contract_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"extracted_value" text,
	"confirmed_value" text,
	"confidence" real,
	"was_edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'party_review' NOT NULL,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"extraction_confidence" real,
	"file_path" text,
	"file_name" text,
	"file_size_bytes" integer,
	"party_a" text,
	"party_b" text,
	"effective_date" date,
	"expiry_date" date,
	"renewal_date" date,
	"auto_renew" boolean,
	"notice_period_days" integer,
	"notice_period_text" text,
	"contract_value" text,
	"annual_value" real,
	"parent_contract_id" uuid,
	"contract_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_analysis" ADD CONSTRAINT "contract_analysis_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_comparisons" ADD CONSTRAINT "contract_comparisons_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_comparisons" ADD CONSTRAINT "contract_comparisons_parent_contract_id_contracts_id_fk" FOREIGN KEY ("parent_contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_extractions" ADD CONSTRAINT "contract_extractions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_contract_type_target" ON "alerts" USING btree ("contract_id","alert_type","target_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_contract_version" ON "contract_analysis" USING btree ("contract_id","analysis_version");--> statement-breakpoint
CREATE UNIQUE INDEX "extractions_contract_field" ON "contract_extractions" USING btree ("contract_id","field_name");
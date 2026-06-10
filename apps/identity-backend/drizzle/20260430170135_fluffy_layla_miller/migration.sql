CREATE TABLE "polkadot_app"."failed_push_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"subscription_id" uuid NOT NULL,
	"statement_hash" text NOT NULL,
	"sender_pubkey" text NOT NULL,
	"topic" text NOT NULL,
	"notify_type" text NOT NULL,
	"delivery_channel" text NOT NULL,
	"trace_id" text,
	"span_id" text,
	"retryable" boolean NOT NULL,
	"attempted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polkadot_app"."push_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"subscription_id" uuid NOT NULL,
	"statement_hash" text NOT NULL,
	"sender_pubkey" text NOT NULL,
	"topic" text NOT NULL,
	"notify_type" text NOT NULL,
	"delivery_channel" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polkadot_app"."push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"notification_type" text NOT NULL,
	"token" text,
	"client_pubkey" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "push_subscription_client_notify_unique_idx" UNIQUE("client_pubkey","notification_type")
);
--> statement-breakpoint
CREATE TABLE "polkadot_app"."rate_limit" (
	"sender_pubkey" text,
	"subscription_id" uuid,
	"window_start" timestamp NOT NULL,
	"notification_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_pkey" PRIMARY KEY("sender_pubkey","subscription_id")
);
--> statement-breakpoint
CREATE TABLE "polkadot_app"."subscription_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"subscription_id" uuid NOT NULL,
	"sender_pubkey" text NOT NULL,
	"topic" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_rule_subscription_sender_topic_unique_idx" UNIQUE("subscription_id","sender_pubkey","topic")
);
--> statement-breakpoint
CREATE INDEX "failed_push_record_subscription_id_idx" ON "polkadot_app"."failed_push_record" ("subscription_id");--> statement-breakpoint
CREATE INDEX "failed_push_record_statement_hash_idx" ON "polkadot_app"."failed_push_record" ("statement_hash");--> statement-breakpoint
CREATE INDEX "failed_push_record_attempted_at_idx" ON "polkadot_app"."failed_push_record" ("attempted_at");--> statement-breakpoint
CREATE INDEX "push_record_subscription_id_idx" ON "polkadot_app"."push_record" ("subscription_id");--> statement-breakpoint
CREATE INDEX "push_record_sent_at_idx" ON "polkadot_app"."push_record" ("sent_at");--> statement-breakpoint
CREATE INDEX "push_subscription_notification_type_idx" ON "polkadot_app"."push_subscription" ("notification_type");--> statement-breakpoint
CREATE INDEX "push_subscription_client_pubkey_idx" ON "polkadot_app"."push_subscription" ("client_pubkey");--> statement-breakpoint
CREATE INDEX "subscription_rule_subscription_id_idx" ON "polkadot_app"."subscription_rule" ("subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_rule_sender_topic_idx" ON "polkadot_app"."subscription_rule" ("sender_pubkey","topic");--> statement-breakpoint
ALTER TABLE "polkadot_app"."failed_push_record" ADD CONSTRAINT "failed_push_record_subscription_id_push_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "polkadot_app"."push_subscription"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "polkadot_app"."push_record" ADD CONSTRAINT "push_record_subscription_id_push_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "polkadot_app"."push_subscription"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "polkadot_app"."rate_limit" ADD CONSTRAINT "rate_limit_subscription_id_push_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "polkadot_app"."push_subscription"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "polkadot_app"."subscription_rule" ADD CONSTRAINT "subscription_rule_subscription_id_push_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "polkadot_app"."push_subscription"("id") ON DELETE CASCADE;
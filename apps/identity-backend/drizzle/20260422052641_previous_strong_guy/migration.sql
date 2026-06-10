CREATE TABLE "polkadot_app"."push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"apns_token" text,
	"voip_token" text,
	"fcm_token" text,
	"client_pubkey" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "push_subscription_client_pubkey_unique_idx" UNIQUE("client_pubkey")
);
--> statement-breakpoint
CREATE INDEX "push_subscription_platform_idx" ON "polkadot_app"."push_subscription" USING btree ("platform");
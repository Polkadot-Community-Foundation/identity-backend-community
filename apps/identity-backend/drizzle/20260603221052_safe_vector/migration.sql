CREATE TABLE "polkadot_app"."android_attestation_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"token_hash" char(64) NOT NULL UNIQUE,
	"challenge_id" char(32) NOT NULL,
	"client_id_hash" char(64) NOT NULL,
	"cert1_fingerprint" char(64) NOT NULL,
	"tee_pub_key" text NOT NULL,
	"app_from_official_store" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"used_at" timestamp,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polkadot_app"."android_device_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"android_id" text NOT NULL UNIQUE,
	"widevine_id" text NOT NULL UNIQUE,
	"account_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "android_attestation_tokens_challenge_id_idx" ON "polkadot_app"."android_attestation_tokens" ("challenge_id");--> statement-breakpoint
CREATE INDEX "android_attestation_tokens_expires_at_idx" ON "polkadot_app"."android_attestation_tokens" ("expires_at");--> statement-breakpoint
CREATE INDEX "android_device_identifiers_account_id_idx" ON "polkadot_app"."android_device_identifiers" ("account_id");
ALTER TABLE "polkadot_app"."push_subscription"
	ADD COLUMN "endpoint" text,
	ADD COLUMN "p256dh_key" text,
	ADD COLUMN "auth_key" text,
	ADD COLUMN "content_encoding" text,
	ADD CONSTRAINT "push_subscription_endpoint_unique_idx" UNIQUE ("endpoint"),
	ADD CONSTRAINT "push_subscription_token_variant_check" CHECK (
		(
			"token" IS NULL
			AND "endpoint" IS NULL
			AND "p256dh_key" IS NULL
			AND "auth_key" IS NULL
			AND "content_encoding" IS NULL
		)
		OR (
			"notification_type" IN ('apns', 'voip', 'fcm')
			AND "token" IS NOT NULL
			AND "endpoint" IS NULL
			AND "p256dh_key" IS NULL
			AND "auth_key" IS NULL
			AND "content_encoding" IS NULL
		)
		OR (
			"notification_type" = 'web'
			AND "token" IS NULL
			AND "endpoint" IS NOT NULL
			AND "p256dh_key" IS NOT NULL
			AND "auth_key" IS NOT NULL
			AND "content_encoding" IN ('aes128gcm', 'aesgcm')
		)
	);--> statement-breakpoint
-- Dedup existing push_record rows before adding the unique constraint.
-- The table had no prior uniqueness on (subscription_id, statement_hash), so
-- retries/redelivery may have created duplicates. Keeping the earliest row per pair.
DELETE FROM "polkadot_app"."push_record"
WHERE ctid NOT IN (
  SELECT min(ctid)
  FROM "polkadot_app"."push_record"
  GROUP BY "subscription_id", "statement_hash"
);--> statement-breakpoint
ALTER TABLE "polkadot_app"."push_record"
	ADD CONSTRAINT "push_record_subscription_statement_unique_idx" UNIQUE ("subscription_id", "statement_hash");

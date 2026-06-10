ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "candidate_signature_dotns" text;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "ah_status" text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "ah_on_chain_data" jsonb;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "ah_retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "ah_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "individuality_username_ah_status_idx" ON "polkadot_app"."individuality_usernames" ("ah_status");
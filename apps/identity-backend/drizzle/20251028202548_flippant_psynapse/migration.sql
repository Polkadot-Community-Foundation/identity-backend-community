ALTER TABLE "polkadot_app"."individuality_usernames" RENAME COLUMN "who" TO "candidate_account_id";--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" RENAME COLUMN "signature" TO "candidate_signature";--> statement-breakpoint
DROP INDEX "polkadot_app"."individuality_username_registered_idx";--> statement-breakpoint
DROP INDEX "polkadot_app"."individuality_username_who_sort_idx";--> statement-breakpoint

ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "reserved_username" text;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "ring_vrf_key" text;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "proof_of_ownership" text;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "consumer_registration_signature" text;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "identifier_key" text;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ADD COLUMN "status" text DEFAULT 'RESERVED' NOT NULL;--> statement-breakpoint

UPDATE "polkadot_app"."individuality_usernames"
SET
  "ring_vrf_key" = COALESCE("ring_vrf_key", ''),
  "proof_of_ownership" = COALESCE("proof_of_ownership", ''),
  "consumer_registration_signature" = COALESCE("consumer_registration_signature", ''),
  "identifier_key" = COALESCE("identifier_key", '');--> statement-breakpoint

ALTER TABLE "polkadot_app"."individuality_usernames" ALTER COLUMN "ring_vrf_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ALTER COLUMN "proof_of_ownership" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ALTER COLUMN "consumer_registration_signature" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" ALTER COLUMN "identifier_key" SET NOT NULL;--> statement-breakpoint

CREATE INDEX "individuality_username_status_idx" ON "polkadot_app"."individuality_usernames" USING btree ("status");--> statement-breakpoint
CREATE INDEX "individuality_username_candidate_idx" ON "polkadot_app"."individuality_usernames" USING btree ("candidate_account_id");--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" DROP COLUMN "chat_key";--> statement-breakpoint
ALTER TABLE "polkadot_app"."individuality_usernames" DROP COLUMN "registered";
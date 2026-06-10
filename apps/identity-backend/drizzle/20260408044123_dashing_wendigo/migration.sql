ALTER TABLE "polkadot_app"."subscription" DROP CONSTRAINT "subscription_client_pubkey_unique";--> statement-breakpoint
DROP INDEX "polkadot_app"."subscription_client_pubkey_idx";--> statement-breakpoint
ALTER TABLE "polkadot_app"."subscription" ALTER COLUMN "client_pubkey" DROP NOT NULL;
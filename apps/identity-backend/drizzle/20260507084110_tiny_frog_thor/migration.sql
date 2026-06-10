ALTER TABLE "polkadot_app"."rate_limit" DROP CONSTRAINT "rate_limit_subscription_id_push_subscription_id_fkey";--> statement-breakpoint
ALTER TABLE "polkadot_app"."rate_limit" RENAME COLUMN "subscription_id" TO "client_id";--> statement-breakpoint
ALTER TABLE "polkadot_app"."rate_limit" ALTER COLUMN "client_id" SET DATA TYPE text USING "client_id"::text;
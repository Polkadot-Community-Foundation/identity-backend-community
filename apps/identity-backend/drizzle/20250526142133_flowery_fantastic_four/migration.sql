CREATE SCHEMA IF NOT EXISTS "polkadot_app";
--> statement-breakpoint
ALTER TABLE "public"."username" SET SCHEMA "polkadot_app";
--> statement-breakpoint
ALTER TABLE "public"."challenges" SET SCHEMA "polkadot_app";
--> statement-breakpoint
ALTER TABLE "public"."apple-attestations" SET SCHEMA "polkadot_app";

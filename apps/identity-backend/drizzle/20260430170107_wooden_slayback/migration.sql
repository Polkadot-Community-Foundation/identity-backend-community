ALTER TABLE "polkadot_app"."failed_push_record" DROP CONSTRAINT "failed_push_record_subscription_id_push_subscription_id_fk";--> statement-breakpoint
ALTER TABLE "polkadot_app"."push_record" DROP CONSTRAINT "push_record_subscription_id_push_subscription_id_fk";--> statement-breakpoint
ALTER TABLE "polkadot_app"."rate_limit" DROP CONSTRAINT "rate_limit_subscription_id_push_subscription_id_fk";--> statement-breakpoint
ALTER TABLE "polkadot_app"."subscription_rule" DROP CONSTRAINT "subscription_rule_subscription_id_push_subscription_id_fk";--> statement-breakpoint
DROP TABLE "polkadot_app"."failed_push_record";--> statement-breakpoint
DROP TABLE "polkadot_app"."push_record";--> statement-breakpoint
DROP TABLE "polkadot_app"."push_subscription";--> statement-breakpoint
DROP TABLE "polkadot_app"."rate_limit";--> statement-breakpoint
DROP TABLE "polkadot_app"."subscription_rule";
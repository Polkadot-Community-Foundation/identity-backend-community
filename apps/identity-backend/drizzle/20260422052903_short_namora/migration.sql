ALTER TABLE "polkadot_app"."subscription" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "polkadot_app"."subscription" CASCADE;--> statement-breakpoint
ALTER TABLE "polkadot_app"."failed_push_record" ADD CONSTRAINT "failed_push_record_subscription_id_push_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "polkadot_app"."push_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polkadot_app"."push_record" ADD CONSTRAINT "push_record_subscription_id_push_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "polkadot_app"."push_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polkadot_app"."rate_limit" ADD CONSTRAINT "rate_limit_subscription_id_push_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "polkadot_app"."push_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polkadot_app"."subscription_rule" ADD CONSTRAINT "subscription_rule_subscription_id_push_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "polkadot_app"."push_subscription"("id") ON DELETE cascade ON UPDATE no action;

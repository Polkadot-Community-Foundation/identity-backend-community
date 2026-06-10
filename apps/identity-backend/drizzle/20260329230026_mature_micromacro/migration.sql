ALTER TABLE "polkadot_app"."dim_tickets" ADD COLUMN "inviter" text DEFAULT '5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM' NOT NULL;--> statement-breakpoint
ALTER TABLE "polkadot_app"."dim_tickets" ADD COLUMN "status" text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "polkadot_app"."dim_tickets" ADD COLUMN "trace_id" text;--> statement-breakpoint
ALTER TABLE "polkadot_app"."dim_tickets" ADD COLUMN "span_id" text;--> statement-breakpoint
CREATE INDEX "dim_ticket_inviter_idx" ON "polkadot_app"."dim_tickets" USING btree ("inviter");--> statement-breakpoint
CREATE INDEX "dim_ticket_status_idx" ON "polkadot_app"."dim_tickets" USING btree ("status");
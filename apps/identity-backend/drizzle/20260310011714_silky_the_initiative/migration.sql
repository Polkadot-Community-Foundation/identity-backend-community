CREATE TABLE "polkadot_app"."dim_tickets" (
	"ticket" text NOT NULL,
	"network" text NOT NULL,
	"dim" text NOT NULL,
	"registered" boolean DEFAULT false NOT NULL,
	"onchain_data" jsonb,
	"retry_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "dim_tickets_ticket_pk" PRIMARY KEY("ticket")
);
--> statement-breakpoint
CREATE INDEX "dim_ticket_network_idx" ON "polkadot_app"."dim_tickets" USING btree ("network");--> statement-breakpoint
CREATE INDEX "dim_ticket_dim_idx" ON "polkadot_app"."dim_tickets" USING btree ("dim");--> statement-breakpoint
CREATE INDEX "dim_ticket_registered_idx" ON "polkadot_app"."dim_tickets" USING btree ("registered");--> statement-breakpoint
CREATE INDEX "dim_ticket_retry_at_idx" ON "polkadot_app"."dim_tickets" USING btree ("retry_at");
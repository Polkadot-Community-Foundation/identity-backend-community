CREATE TABLE "polkadot_app"."invitation_tickets" (
	"public_key" text PRIMARY KEY NOT NULL,
	"private_key" text NOT NULL,
	"dim" text NOT NULL,
	"network" text NOT NULL,
	"inviter" text NOT NULL,
	"state" text DEFAULT 'available' NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "invitation_ticket_claimable_idx" ON "polkadot_app"."invitation_tickets" USING btree ("state","dim","network");
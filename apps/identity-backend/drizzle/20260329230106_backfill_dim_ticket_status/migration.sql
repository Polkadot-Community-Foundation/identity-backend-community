-- Backfill status column from registered boolean before dropping registered
UPDATE "polkadot_app"."dim_tickets" SET "status" = 'REGISTERED' WHERE "registered" = true;--> statement-breakpoint
UPDATE "polkadot_app"."dim_tickets" SET "status" = 'PENDING' WHERE "registered" = false;

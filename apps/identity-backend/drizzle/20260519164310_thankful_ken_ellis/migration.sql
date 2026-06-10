CREATE TABLE "polkadot_app"."registration_queue_entries" (
	"id" serial PRIMARY KEY,
	"candidate_account_id" text NOT NULL,
	"username" text NOT NULL,
	"priority_group" integer NOT NULL,
	"network" text NOT NULL,
	"enqueued_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "registration_queue_account_network_unique" UNIQUE("candidate_account_id","network")
);
--> statement-breakpoint
CREATE INDEX "registration_queue_priority_enqueued_idx" ON "polkadot_app"."registration_queue_entries" ("priority_group","enqueued_at");--> statement-breakpoint
CREATE INDEX "registration_queue_candidate_idx" ON "polkadot_app"."registration_queue_entries" ("candidate_account_id");
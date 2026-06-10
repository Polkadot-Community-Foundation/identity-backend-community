CREATE TABLE "polkadot_app"."individuality_usernames" (
	"username" text NOT NULL,
	"digits" char(2) NOT NULL,
	"network" text NOT NULL,
	"who" text NOT NULL,
	"signature" text NOT NULL,
	"registered" boolean NOT NULL,
	"on_chain_data" jsonb,
	"retry_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "individuality_usernames_username_network_digits_pk" PRIMARY KEY("username","network","digits")
);
--> statement-breakpoint
CREATE INDEX "individuality_username_network_idx" ON "polkadot_app"."individuality_usernames" USING btree ("network");--> statement-breakpoint
CREATE INDEX "individuality_username_registered_idx" ON "polkadot_app"."individuality_usernames" USING btree ("registered");--> statement-breakpoint
CREATE INDEX "individuality_username_created_at_idx" ON "polkadot_app"."individuality_usernames" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "individuality_username_username_sort_idx" ON "polkadot_app"."individuality_usernames" USING btree ("username");--> statement-breakpoint
CREATE INDEX "individuality_username_who_sort_idx" ON "polkadot_app"."individuality_usernames" USING btree ("who");
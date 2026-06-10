CREATE TABLE IF NOT EXISTS "kilt_usernames" (
	"username" text PRIMARY KEY NOT NULL,
	"user_public_key" text NOT NULL,
	"associate_account_address" text,
	"associate_address_signature" text NOT NULL,
	"registered" boolean NOT NULL,
	"on_chain_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kilt_usernames" ADD CONSTRAINT "kilt_usernames_associate_account_address_keypairs_ss58_address_fk" FOREIGN KEY ("associate_account_address") REFERENCES "public"."keypairs"("ss58_address") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

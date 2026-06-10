ALTER TABLE "kilt_usernames" RENAME COLUMN "associate_account_address" TO "associate_account_ss58Address";--> statement-breakpoint
ALTER TABLE "kilt_usernames" RENAME COLUMN "associate_address_signature" TO "associate_account_request_signature";--> statement-breakpoint
ALTER TABLE "kilt_usernames" DROP CONSTRAINT "kilt_usernames_associate_account_address_keypairs_ss58_address_fk";
--> statement-breakpoint
ALTER TABLE "kilt_usernames" ADD COLUMN "associate_account_expiration" bigint NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kilt_usernames" ADD CONSTRAINT "kilt_usernames_associate_account_ss58Address_keypairs_ss58_address_fk" FOREIGN KEY ("associate_account_ss58Address") REFERENCES "public"."keypairs"("ss58_address") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "associate_account_idx" ON "kilt_usernames" USING btree ("associate_account_ss58Address");
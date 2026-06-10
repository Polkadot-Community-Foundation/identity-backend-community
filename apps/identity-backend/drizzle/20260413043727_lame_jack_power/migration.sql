CREATE TABLE "polkadot_app"."refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"family_id" uuid,
	"rotated_from" uuid,
	"revoked_at" timestamp,
	"revoked_reason" text,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "polkadot_app"."refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_at_idx" ON "polkadot_app"."refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_rotated_from_idx" ON "polkadot_app"."refresh_tokens" USING btree ("rotated_from");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "polkadot_app"."refresh_tokens" USING btree ("family_id");
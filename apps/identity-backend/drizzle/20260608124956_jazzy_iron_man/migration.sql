CREATE TABLE "polkadot_app"."lifetime_poud_vouchers" (
	"key" text PRIMARY KEY,
	"used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lifetime_poud_vouchers_used_idx" ON "polkadot_app"."lifetime_poud_vouchers" ("used");
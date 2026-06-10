CREATE TABLE "polkadot_app"."leader_election" (
	"key" text PRIMARY KEY,
	"holder" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL
);

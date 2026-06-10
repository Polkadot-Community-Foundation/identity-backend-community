CREATE TABLE IF NOT EXISTS "keypairs" (
	"ss58_address" text PRIMARY KEY NOT NULL,
	"ss58_prefix" integer NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);

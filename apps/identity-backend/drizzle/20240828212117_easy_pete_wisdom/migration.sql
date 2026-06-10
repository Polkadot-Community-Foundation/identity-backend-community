CREATE TABLE IF NOT EXISTS "username" (
	"username" text PRIMARY KEY NOT NULL,
	"who" text NOT NULL,
	"signature" text NOT NULL,
	"registered" boolean NOT NULL,
	"onchainData" jsonb
);

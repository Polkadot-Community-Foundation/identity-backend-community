CREATE TABLE IF NOT EXISTS "challenges" (
	"challenge" char(32) PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

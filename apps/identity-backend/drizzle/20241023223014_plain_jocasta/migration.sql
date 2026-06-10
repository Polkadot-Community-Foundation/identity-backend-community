CREATE TABLE IF NOT EXISTS "apple-attestations" (
	"key_id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"receipt" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

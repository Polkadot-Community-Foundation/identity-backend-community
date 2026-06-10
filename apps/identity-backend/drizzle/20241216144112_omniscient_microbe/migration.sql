ALTER TABLE "kilt_usernames" ADD COLUMN "retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "kilt_usernames" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "username" ADD COLUMN "retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "username" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "username" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "username" ADD COLUMN "updated_at" timestamp;
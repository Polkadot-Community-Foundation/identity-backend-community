CREATE TYPE "public"."people_network" AS ENUM('westend2', 'paseo');--> statement-breakpoint
ALTER TABLE "username" ADD COLUMN "network" "people_network" DEFAULT 'westend2' NOT NULL;
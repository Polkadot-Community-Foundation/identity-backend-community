ALTER TABLE "username" DROP CONSTRAINT "username_pkey";--> statement-breakpoint
ALTER TABLE "username" ADD CONSTRAINT "username_username_network_pk" PRIMARY KEY("username","network");

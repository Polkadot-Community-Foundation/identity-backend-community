CREATE INDEX "registered_idx" ON "username" USING btree ("registered");--> statement-breakpoint
CREATE INDEX "created_at_idx" ON "username" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "username_sort_idx" ON "username" USING btree ("username");--> statement-breakpoint
CREATE INDEX "who_sort_idx" ON "username" USING btree ("who");
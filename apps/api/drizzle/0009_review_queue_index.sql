DROP INDEX "product_review_status_idx";--> statement-breakpoint
CREATE INDEX "product_review_status_idx" ON "product_review" USING btree ("status","updated_at","id");
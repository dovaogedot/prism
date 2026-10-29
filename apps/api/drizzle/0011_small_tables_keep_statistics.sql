-- Tables of a handful of rows never reach autovacuum's default analyze threshold of 50 changed rows. With a threshold of 0, any change to them refreshes the planner's statistics, and the ANALYZE gives them statistics at once.
ALTER TABLE "category" SET (autovacuum_analyze_threshold = 0);--> statement-breakpoint
ALTER TABLE "brand" SET (autovacuum_analyze_threshold = 0);--> statement-breakpoint
ALTER TABLE "shipping_method" SET (autovacuum_analyze_threshold = 0);--> statement-breakpoint
ANALYZE "category", "brand", "shipping_method";

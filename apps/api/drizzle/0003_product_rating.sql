ALTER TABLE "product" ADD COLUMN "rating_average" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_rating_range" CHECK (("product"."rating_count" = 0 AND "product"."rating_average" = 0) OR ("product"."rating_count" > 0 AND "product"."rating_average" BETWEEN 1 AND 5));--> statement-breakpoint
UPDATE "product" SET "rating_average" = "rating"."average", "rating_count" = "rating"."count" FROM (SELECT "product_id", avg("rating")::float AS "average", count(*)::int AS "count" FROM "product_review" WHERE "status" = 'approved' GROUP BY "product_id") AS "rating" WHERE "rating"."product_id" = "product"."id";--> statement-breakpoint
CREATE FUNCTION "product_rating_refresh"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	changed uuid[] := CASE TG_OP
		WHEN 'INSERT' THEN ARRAY[NEW."product_id"]
		WHEN 'DELETE' THEN ARRAY[OLD."product_id"]
		ELSE ARRAY[OLD."product_id", NEW."product_id"]
	END;
BEGIN
	-- The lock comes first, so the count below, a statement of its own, sees what other sessions committed to these products' reviews.
	PERFORM 1 FROM "product" WHERE "id" = ANY (changed) ORDER BY "id" FOR UPDATE;
	UPDATE "product" SET
		"rating_count" = (SELECT count(*)::int FROM "product_review" WHERE "product_review"."product_id" = "product"."id" AND "product_review"."status" = 'approved'),
		"rating_average" = COALESCE((SELECT avg("rating")::float FROM "product_review" WHERE "product_review"."product_id" = "product"."id" AND "product_review"."status" = 'approved'), 0)
	WHERE "id" = ANY (changed);
	RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "product_review_rating" AFTER INSERT OR DELETE OR UPDATE OF "rating", "status", "product_id" ON "product_review" FOR EACH ROW EXECUTE FUNCTION "product_rating_refresh"();
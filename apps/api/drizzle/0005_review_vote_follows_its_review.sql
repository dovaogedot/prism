ALTER TABLE "review_vote" DROP CONSTRAINT "review_vote_review_id_product_review_id_fk";
--> statement-breakpoint
ALTER TABLE "review_vote" ADD CONSTRAINT "review_vote_review_id_product_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."product_review"("id") ON DELETE cascade ON UPDATE cascade;
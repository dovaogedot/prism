CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "shipping_method" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"free_from_cents" integer,
	"min_days" integer NOT NULL,
	"max_days" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_method_price_not_negative" CHECK ("shipping_method"."price_cents" >= 0),
	CONSTRAINT "shipping_method_free_from_positive" CHECK ("shipping_method"."free_from_cents" IS NULL OR "shipping_method"."free_from_cents" > 0),
	CONSTRAINT "shipping_method_days_range" CHECK (1 <= "shipping_method"."min_days" AND "shipping_method"."min_days" <= "shipping_method"."max_days" AND "shipping_method"."max_days" <= 30)
);--> statement-breakpoint
INSERT INTO "shipping_method" ("code", "name", "price_cents", "free_from_cents", "min_days", "max_days", "position") VALUES
	('standard', 'Standard', 490, 5000, 2, 4, 0),
	('express', 'Express', 990, NULL, 1, 2, 1);--> statement-breakpoint
CREATE TABLE "review_vote" (
	"review_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_vote_review_id_user_id_pk" PRIMARY KEY("review_id","user_id")
);--> statement-breakpoint
CREATE TABLE "address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"details" "bytea" NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid,
	"actor_roles" text[] DEFAULT '{}' NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"summary" text NOT NULL,
	"changes" jsonb,
	"ip" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE FUNCTION "audit_event_refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_event is append-only: % is not allowed', TG_OP;
END
$$;--> statement-breakpoint
CREATE TRIGGER "audit_event_append_only" BEFORE UPDATE OR DELETE ON "audit_event" FOR EACH STATEMENT EXECUTE FUNCTION "audit_event_refuse_change"();--> statement-breakpoint
ALTER TABLE "app_user" DROP CONSTRAINT "app_user_email_lowercase";--> statement-breakpoint
ALTER TABLE "app_user" DROP CONSTRAINT "app_user_email_shape";--> statement-breakpoint
ALTER TABLE "app_user" DROP CONSTRAINT "app_user_totp_needs_secret";--> statement-breakpoint
DROP INDEX "app_user_email_key";--> statement-breakpoint
ALTER TABLE "app_user" RENAME COLUMN "email" TO "legacy_email";--> statement-breakpoint
ALTER TABLE "app_user" ALTER COLUMN "legacy_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" RENAME COLUMN "totp_secret" TO "legacy_totp_secret";--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "email" "bytea";--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "email_index" "bytea";--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "totp_secret" "bytea";--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "roles" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "full_name" "bytea";--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "phone" "bytea";--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_index_key" ON "app_user" USING btree ("email_index");--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_roles_known" CHECK ("app_user"."roles" <@ ARRAY['moderator', 'content_manager', 'delivery_manager', 'support', 'admin']::text[]);--> statement-breakpoint
DROP INDEX "oauth_identity_provider_subject_key";--> statement-breakpoint
ALTER TABLE "oauth_identity" RENAME COLUMN "subject" TO "legacy_subject";--> statement-breakpoint
ALTER TABLE "oauth_identity" ALTER COLUMN "legacy_subject" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_identity" ADD COLUMN "subject" "bytea";--> statement-breakpoint
ALTER TABLE "oauth_identity" ADD COLUMN "subject_index" "bytea";--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_identity_provider_subject_index_key" ON "oauth_identity" USING btree ("provider","subject_index");--> statement-breakpoint
ALTER TABLE "session" RENAME COLUMN "user_agent" TO "legacy_user_agent";--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "legacy_user_agent" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "legacy_user_agent" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "session" RENAME COLUMN "ip_address" TO "legacy_ip_address";--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "legacy_ip_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "legacy_ip_address" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "user_agent" "bytea";--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "ip_address" "bytea";--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "second_factor_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "featured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "product" SET "updated_at" = "created_at";--> statement-breakpoint
CREATE INDEX "product_name_trgm_idx" ON "product" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_featured_idx" ON "product" USING btree ("featured_at") WHERE "product"."featured_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "product_image" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "product_image" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "product_image" ADD COLUMN "is_pixel_art" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Every picture stored before this migration came from the seed's catalog, which is pixel art.
UPDATE "product_image" SET "is_pixel_art" = true;--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_size_whole" CHECK (("product_image"."width" IS NULL) = ("product_image"."height" IS NULL));--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_size_positive" CHECK ("product_image"."width" > 0 AND "product_image"."height" > 0);--> statement-breakpoint
DROP INDEX "product_review_product_idx";--> statement-breakpoint
-- Reviews written before moderation existed are published, under a neutral byline.
ALTER TABLE "product_review" ADD COLUMN "author_name" text DEFAULT 'Prism customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_review" ALTER COLUMN "author_name" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "product_review" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "product_review" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "product_review" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_review" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "product_review" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "product_review" ADD COLUMN "helpful_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_review" ADD COLUMN "moderated_by" uuid;--> statement-breakpoint
ALTER TABLE "product_review" ADD COLUMN "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_review" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "product_review" SET "updated_at" = "created_at";--> statement-breakpoint
ALTER TABLE "product_review" ADD CONSTRAINT "product_review_moderated_by_app_user_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_review_listing_idx" ON "product_review" USING btree ("product_id","status","helpful_count" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "product_review_status_idx" ON "product_review" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "product_review" ADD CONSTRAINT "product_review_author_length" CHECK (char_length("product_review"."author_name") BETWEEN 2 AND 40);--> statement-breakpoint
ALTER TABLE "product_review" ADD CONSTRAINT "product_review_title_length" CHECK (char_length("product_review"."title") BETWEEN 1 AND 120);--> statement-breakpoint
ALTER TABLE "product_review" ADD CONSTRAINT "product_review_body_length" CHECK (char_length("product_review"."body") BETWEEN 1 AND 2000);--> statement-breakpoint
ALTER TABLE "product_review" ADD CONSTRAINT "product_review_status_known" CHECK ("product_review"."status" IN ('pending', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "product_review" ADD CONSTRAINT "product_review_reason_when_rejected" CHECK (("product_review"."rejection_reason" IS NOT NULL) = ("product_review"."status" = 'rejected'));--> statement-breakpoint
ALTER TABLE "product_review" ADD CONSTRAINT "product_review_helpful_not_negative" CHECK ("product_review"."helpful_count" >= 0);--> statement-breakpoint
ALTER TABLE "order_event" DROP CONSTRAINT "order_event_status_known";--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_status_known" CHECK ("order_event"."status" IN ('pending_payment', 'payment_successful', 'payment_failed', 'processing', 'shipped', 'delivered', 'canceled', 'refunded'));--> statement-breakpoint
ALTER TABLE "customer_order" DROP CONSTRAINT "customer_order_shipping_known";--> statement-breakpoint
ALTER TABLE "customer_order" DROP CONSTRAINT "customer_order_status_known";--> statement-breakpoint
ALTER TABLE "customer_order" DROP CONSTRAINT "customer_order_tracking_when_shipped";--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "shipping_method_name" text;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "estimated_delivery_from" date;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "estimated_delivery_to" date;--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "billing_address" "bytea";--> statement-breakpoint
ALTER TABLE "customer_order" ADD COLUMN "email_index" "bytea";--> statement-breakpoint
-- Placed orders take the method's name, and the business days of its window counted from the order's day in Tallinn.
UPDATE "customer_order" AS "placed" SET
	"shipping_method_name" = "method"."name",
	"estimated_delivery_from" = (
		SELECT (array_agg("day"::date ORDER BY "day"))["method"."min_days"]
		FROM generate_series(("placed"."created_at" AT TIME ZONE 'Europe/Tallinn')::date + 1, ("placed"."created_at" AT TIME ZONE 'Europe/Tallinn')::date + 60, interval '1 day') AS "day"
		WHERE extract(isodow FROM "day") < 6
	),
	"estimated_delivery_to" = (
		SELECT (array_agg("day"::date ORDER BY "day"))["method"."max_days"]
		FROM generate_series(("placed"."created_at" AT TIME ZONE 'Europe/Tallinn')::date + 1, ("placed"."created_at" AT TIME ZONE 'Europe/Tallinn')::date + 60, interval '1 day') AS "day"
		WHERE extract(isodow FROM "day") < 6
	)
FROM "shipping_method" AS "method"
WHERE "method"."code" = "placed"."shipping_method";--> statement-breakpoint
ALTER TABLE "customer_order" ALTER COLUMN "shipping_method_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_order" ALTER COLUMN "estimated_delivery_from" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_order" ALTER COLUMN "estimated_delivery_to" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_shipping_method_shipping_method_code_fk" FOREIGN KEY ("shipping_method") REFERENCES "public"."shipping_method"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_order_email_index_idx" ON "customer_order" USING btree ("email_index");--> statement-breakpoint
CREATE INDEX "customer_order_created_idx" ON "customer_order" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_status_known" CHECK ("customer_order"."status" IN ('pending_payment', 'payment_successful', 'payment_failed', 'processing', 'shipped', 'delivered', 'canceled', 'refunded'));--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_tracking_when_shipped" CHECK ("customer_order"."status" NOT IN ('shipped', 'delivered') OR "customer_order"."tracking_number" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_tracking_after_shipping" CHECK ("customer_order"."tracking_number" IS NULL OR "customer_order"."status" IN ('shipped', 'delivered', 'refunded'));--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_delivery_window" CHECK ("customer_order"."estimated_delivery_from" <= "customer_order"."estimated_delivery_to");--> statement-breakpoint
ALTER TABLE "address" ADD CONSTRAINT "address_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_vote" ADD CONSTRAINT "review_vote_review_id_product_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."product_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_vote" ADD CONSTRAINT "review_vote_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "address_user_idx" ON "address" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "address_one_default_key" ON "address" USING btree ("user_id") WHERE "address"."is_default";--> statement-breakpoint
CREATE INDEX "audit_event_created_idx" ON "audit_event" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_actor_created_idx" ON "audit_event" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_target_idx" ON "audit_event" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "review_vote_user_idx" ON "review_vote" USING btree ("user_id");
CREATE TABLE "brand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "product_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"file" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_property" (
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "product_property_product_id_name_pk" PRIMARY KEY("product_id","name")
);
--> statement-breakpoint
CREATE TABLE "product_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_review_rating_range" CHECK ("product_review"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"price_cents" integer NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"category_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"weight_grams" integer NOT NULL,
	"width_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"depth_mm" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', name), 'A') || setweight(to_tsvector('english', description), 'C')) STORED NOT NULL,
	CONSTRAINT "product_price_not_negative" CHECK ("product"."price_cents" >= 0),
	CONSTRAINT "product_stock_not_negative" CHECK ("product"."stock" >= 0),
	CONSTRAINT "product_measures_positive" CHECK ("product"."weight_grams" > 0 AND "product"."width_mm" > 0 AND "product"."height_mm" > 0 AND "product"."depth_mm" > 0)
);
--> statement-breakpoint
CREATE TABLE "refresh_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"user_agent" text DEFAULT '' NOT NULL,
	"ip_address" text DEFAULT '' NOT NULL,
	CONSTRAINT "session_revocation_has_reason" CHECK (("session"."revoked_at" IS NULL) = ("session"."revoked_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"totp_secret" text,
	"totp_enabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_lowercase" CHECK ("app_user"."email" = lower("app_user"."email")),
	CONSTRAINT "app_user_email_shape" CHECK ("app_user"."email" LIKE '%_@_%'),
	CONSTRAINT "app_user_totp_needs_secret" CHECK ("app_user"."totp_enabled_at" IS NULL OR "app_user"."totp_secret" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "oauth_identity" ADD CONSTRAINT "oauth_identity_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_property" ADD CONSTRAINT "product_property_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_review" ADD CONSTRAINT "product_review_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_review" ADD CONSTRAINT "product_review_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_slug_key" ON "brand" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "category_slug_key" ON "category" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_identity_provider_subject_key" ON "oauth_identity" USING btree ("provider","subject");--> statement-breakpoint
CREATE INDEX "oauth_identity_user_idx" ON "oauth_identity" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_token_hash_key" ON "password_reset_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_token_user_idx" ON "password_reset_token" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_image_position_key" ON "product_image" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "product_property_name_value_idx" ON "product_property" USING btree ("name","value");--> statement-breakpoint
CREATE UNIQUE INDEX "product_review_one_per_user_key" ON "product_review" USING btree ("product_id","user_id");--> statement-breakpoint
CREATE INDEX "product_review_product_idx" ON "product_review" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_slug_key" ON "product" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "product_category_idx" ON "product" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "product_brand_idx" ON "product" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "product_price_idx" ON "product" USING btree ("price_cents");--> statement-breakpoint
CREATE INDEX "product_search_idx" ON "product" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_token_hash_key" ON "refresh_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_token_session_idx" ON "refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_live_idx" ON "session" USING btree ("id") WHERE "session"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user" USING btree ("email");
CREATE TABLE "cart_item" (
	"cart_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_item_cart_id_product_id_pk" PRIMARY KEY("cart_id","product_id"),
	CONSTRAINT "cart_item_quantity_range" CHECK ("cart_item"."quantity" BETWEEN 1 AND 99)
);
--> statement-breakpoint
CREATE TABLE "cart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "cart_one_owner" CHECK (("cart"."user_id" IS NULL) <> ("cart"."token_hash" IS NULL)),
	CONSTRAINT "cart_guest_expires" CHECK ("cart"."user_id" IS NOT NULL OR "cart"."expires_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "order_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_event_status_known" CHECK ("order_event"."status" IN ('pending_payment', 'payment_successful', 'payment_failed', 'processing', 'shipped', 'delivered', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"product_name" text NOT NULL,
	"product_slug" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	CONSTRAINT "order_line_quantity_positive" CHECK ("order_line"."quantity" >= 1),
	CONSTRAINT "order_line_price_not_negative" CHECK ("order_line"."unit_price_cents" >= 0),
	CONSTRAINT "order_line_total_adds_up" CHECK ("order_line"."line_total_cents" = "order_line"."unit_price_cents" * "order_line"."quantity")
);
--> statement-breakpoint
CREATE TABLE "customer_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "customer_order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 100001 CACHE 1),
	"user_id" uuid,
	"cart_id" uuid,
	"status" text NOT NULL,
	"shipping_method" text NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"shipping_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"contact" "bytea" NOT NULL,
	"shipping_address" "bytea" NOT NULL,
	"access_key" "bytea",
	"tracking_number" text,
	"refunded_at" timestamp with time zone,
	"payment_due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_order_status_known" CHECK ("customer_order"."status" IN ('pending_payment', 'payment_successful', 'payment_failed', 'processing', 'shipped', 'delivered', 'canceled')),
	CONSTRAINT "customer_order_shipping_known" CHECK ("customer_order"."shipping_method" IN ('standard', 'express')),
	CONSTRAINT "customer_order_money_not_negative" CHECK ("customer_order"."subtotal_cents" >= 0 AND "customer_order"."shipping_cents" >= 0 AND "customer_order"."total_cents" >= 0),
	CONSTRAINT "customer_order_total_adds_up" CHECK ("customer_order"."total_cents" = "customer_order"."subtotal_cents" + "customer_order"."shipping_cents"),
	CONSTRAINT "customer_order_has_owner" CHECK ("customer_order"."user_id" IS NOT NULL OR "customer_order"."access_key" IS NOT NULL),
	CONSTRAINT "customer_order_tracking_when_shipped" CHECK (("customer_order"."tracking_number" IS NOT NULL) = ("customer_order"."status" IN ('shipped', 'delivered')))
);
--> statement-breakpoint
CREATE TABLE "outbox_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exchange" text NOT NULL,
	"routing_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"reference" "bytea",
	"details" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_kind_known" CHECK ("payment"."kind" IN ('charge', 'refund')),
	CONSTRAINT "payment_status_known" CHECK ("payment"."status" IN ('pending', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "payment_amount_not_negative" CHECK ("payment"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_cart_id_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."cart"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart" ADD CONSTRAINT "cart_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_order_id_customer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_customer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_cart_id_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."cart"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_customer_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."customer_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_item_product_idx" ON "cart_item" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_user_key" ON "cart" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_token_hash_key" ON "cart" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "cart_guest_expiry_idx" ON "cart" USING btree ("expires_at") WHERE "cart"."user_id" IS NULL;--> statement-breakpoint
CREATE INDEX "order_event_order_created_idx" ON "order_event" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_line_product_key" ON "order_line" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE INDEX "order_line_product_idx" ON "order_line" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_order_number_key" ON "customer_order" USING btree ("number");--> statement-breakpoint
CREATE INDEX "customer_order_user_created_idx" ON "customer_order" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customer_order_status_changed_idx" ON "customer_order" USING btree ("status","status_changed_at");--> statement-breakpoint
CREATE INDEX "outbox_message_unpublished_idx" ON "outbox_message" USING btree ("created_at") WHERE "outbox_message"."published_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_kind_key" ON "payment" USING btree ("order_id","kind");
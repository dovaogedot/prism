-- The catalog: categories, foundries, colors, swatch images, reviews.
--
-- Note what is NOT here: no rating_avg, no rating_count, no hue/saturation
-- columns the application writes, no imperial measurements. Every one of those
-- is derivable, so every one of them is derived — by a generated column where
-- it must be indexable, by the product_listing view where it aggregates, and
-- in @prism/shared where it is pure presentation.

CREATE TABLE category (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text    NOT NULL,
  name        text    NOT NULL,
  description text    NOT NULL DEFAULT '',
  parent_id   uuid    REFERENCES category (id) ON DELETE RESTRICT,
  position    integer NOT NULL DEFAULT 0,

  search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || description)) STORED,

  CONSTRAINT category_slug_shape CHECK (slug ~ '^[a-z0-9-]+$'),
  CONSTRAINT category_not_own_parent CHECK (parent_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX category_slug_key ON category (slug);
CREATE INDEX category_parent_idx ON category (parent_id);
CREATE INDEX category_search_idx ON category USING gin (search_vector);
CREATE INDEX category_name_trgm_idx ON category USING gin (name gin_trgm_ops);

CREATE TABLE brand (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',

  search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || description)) STORED,

  CONSTRAINT brand_slug_shape CHECK (slug ~ '^[a-z0-9-]+$')
);

CREATE UNIQUE INDEX brand_slug_key ON brand (slug);
CREATE INDEX brand_search_idx ON brand USING gin (search_vector);
CREATE INDEX brand_name_trgm_idx ON brand USING gin (name gin_trgm_ops);

CREATE TABLE product (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text           NOT NULL,
  name           text           NOT NULL,
  description    text           NOT NULL,
  price_cents    integer        NOT NULL,
  stock_quantity integer        NOT NULL DEFAULT 0,
  category_id    uuid           NOT NULL REFERENCES category (id) ON DELETE RESTRICT,
  brand_id       uuid           NOT NULL REFERENCES brand (id) ON DELETE RESTRICT,

  -- The single stored fact about the color itself.
  hex            text           NOT NULL,
  finish         product_finish NOT NULL,

  -- Derived from hex, materialized by Postgres so they can be indexed.
  -- GENERATED ALWAYS means the application cannot write them even by mistake.
  hue        smallint GENERATED ALWAYS AS (hex_to_hue(hex)) STORED,
  saturation smallint GENERATED ALWAYS AS (hex_to_saturation(hex)) STORED,
  lightness  smallint GENERATED ALWAYS AS (hex_to_lightness(hex)) STORED,

  -- The vial. Imperial equivalents are derived in @prism/shared, never stored.
  weight_grams integer NOT NULL,
  length_mm    integer NOT NULL,
  width_mm     integer NOT NULL,
  height_mm    integer NOT NULL,

  -- Name outranks description when ranking relevance. Brand and category live
  -- in other tables, so they carry their own vectors and the search query ORs
  -- across all three rather than denormalizing them into this row.
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', name), 'A')
    || setweight(to_tsvector('english', description), 'C')
  ) STORED,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_slug_shape CHECK (slug ~ '^[a-z0-9-]+$'),
  CONSTRAINT product_hex_shape CHECK (hex ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT product_price_non_negative CHECK (price_cents >= 0),
  CONSTRAINT product_stock_non_negative CHECK (stock_quantity >= 0),
  CONSTRAINT product_dimensions_positive CHECK (
    weight_grams > 0 AND length_mm > 0 AND width_mm > 0 AND height_mm > 0
  )
);

CREATE UNIQUE INDEX product_slug_key ON product (slug);
CREATE INDEX product_category_idx ON product (category_id);
CREATE INDEX product_brand_idx ON product (brand_id);
CREATE INDEX product_price_idx ON product (price_cents);
CREATE INDEX product_finish_idx ON product (finish);
CREATE INDEX product_search_idx ON product USING gin (search_vector);
CREATE INDEX product_name_trgm_idx ON product USING gin (name gin_trgm_ops);

-- The whole reason hue/saturation are materialized rather than computed per row.
CREATE INDEX product_hue_idx ON product (hue);
CREATE INDEX product_saturation_idx ON product (saturation);

CREATE TABLE product_image (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid        NOT NULL REFERENCES product (id) ON DELETE CASCADE,
  -- Content-addressed: the filename is the SHA-256 of the bytes, so the same
  -- image uploaded twice occupies one file and cache keys never go stale.
  filename   text        NOT NULL,
  alt        text        NOT NULL DEFAULT '',
  position   integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_image_filename_shape CHECK (filename ~ '^[a-f0-9]{64}\.(png|jpg|webp)$')
);

CREATE INDEX product_image_product_idx ON product_image (product_id);

CREATE TABLE product_review (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid        NOT NULL REFERENCES product (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  rating     smallint    NOT NULL,
  body       text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_review_rating_range CHECK (rating BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX product_review_one_per_user_key
  ON product_review (product_id, user_id);
CREATE INDEX product_review_product_idx ON product_review (product_id);

-- Every catalog read goes through this view, so a displayed rating can never
-- disagree with the reviews it came from. Making it MATERIALIZED is the only
-- change needed if aggregation ever costs too much; no application code moves.
CREATE VIEW product_listing AS
SELECT
  p.id,
  p.slug,
  p.name,
  p.description,
  p.price_cents,
  p.stock_quantity,
  p.hex,
  p.finish,
  p.hue,
  p.saturation,
  p.lightness,
  p.weight_grams,
  p.length_mm,
  p.width_mm,
  p.height_mm,
  p.created_at,
  -- Three vectors rather than one concatenated column: each stays a plain
  -- reference to an indexed base-table column, so Postgres can push the
  -- predicate down and use the GIN index on whichever table matched.
  p.search_vector,
  b.search_vector AS brand_search_vector,
  c.search_vector AS category_search_vector,
  b.id   AS brand_id,
  b.slug AS brand_slug,
  b.name AS brand_name,
  c.id   AS category_id,
  c.slug AS category_slug,
  c.name AS category_name,
  COALESCE(AVG(r.rating), 0)::numeric(3, 2) AS rating_average,
  COUNT(r.id)::integer                      AS rating_count
FROM product p
JOIN brand b ON b.id = p.brand_id
JOIN category c ON c.id = p.category_id
LEFT JOIN product_review r ON r.product_id = p.id
GROUP BY p.id, b.id, c.id;

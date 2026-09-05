-- The catalog: foundries, products, and one table per kind of product.
--
-- A product is one of three things and they share almost nothing, so the parts
-- they share are in `product` and the parts they do not are in `color`,
-- `finisher` and `shifter`. Every column in those three is NOT NULL, because a
-- column only exists where it applies — there is no `hex` on a shifter to be
-- null, and no CHECK constraint standing in for a shape the tables already have.
--
-- Each sub-table carries its own `kind` and points at `product (id, kind)`, so
-- the database refuses a color row attached to a shifter. That is the one thing
-- a plain foreign key on `product_id` could not say.
--
-- Note what is NOT here: no rating_avg, no rating_count, no hue or saturation
-- the application writes, no color family anyone filed by hand, no imperial
-- measurements. Every one of those is derivable, so every one is derived — by a
-- generated column where it must be indexable, by `product_listing` where it
-- aggregates, and in @prism/shared where it is pure presentation.

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
CREATE INDEX brand_name_trgm_idx ON brand USING gin (name gin_trgm_ops);

/* ------------------------------------------------ what every product shares */

CREATE TABLE product (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text         NOT NULL,
  name           text         NOT NULL,
  description    text         NOT NULL,
  price_cents    integer      NOT NULL,
  stock_quantity integer      NOT NULL DEFAULT 0,
  brand_id       uuid         NOT NULL REFERENCES brand (id) ON DELETE RESTRICT,
  kind           product_kind NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),

  -- The name outranks the description, so a color called "Gold Leaf" beats one
  -- whose blurb mentions gold.
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', name), 'A')
      || setweight(to_tsvector('english', description), 'C')
  ) STORED,

  CONSTRAINT product_slug_shape CHECK (slug ~ '^[a-z0-9-]+$'),
  CONSTRAINT product_price_non_negative CHECK (price_cents >= 0),
  CONSTRAINT product_stock_non_negative CHECK (stock_quantity >= 0),

  -- What the three sub-tables point at, so each one can only attach to a
  -- product already declared to be its kind.
  CONSTRAINT product_id_kind_key UNIQUE (id, kind)
);

CREATE UNIQUE INDEX product_slug_key ON product (slug);
CREATE INDEX product_kind_idx ON product (kind);
CREATE INDEX product_brand_idx ON product (brand_id);
CREATE INDEX product_price_idx ON product (price_cents);
CREATE INDEX product_search_idx ON product USING gin (search_vector);
CREATE INDEX product_name_trgm_idx ON product USING gin (name gin_trgm_ops);

/* ------------------------------------------------------------------ a color */

CREATE TABLE color (
  product_id uuid         PRIMARY KEY,
  kind       product_kind NOT NULL DEFAULT 'color',

  hex        text     NOT NULL,
  -- 5 is a mirror and 95 is chalk. Note the direction: this is roughness, so a
  -- lacquered surface is a low number and a matte one is a high one.
  roughness  smallint NOT NULL,
  -- Nanometers of interference coating. Zero is bare paint. The color it shows
  -- is the wavelength that fits twice through it, so this number is the color.
  coating_nanometers smallint NOT NULL,
  -- How hard the pigment gives off its own light. Zero for most colors.
  emission   smallint NOT NULL,

  hue        smallint GENERATED ALWAYS AS (hex_to_hue(hex)) STORED,
  saturation smallint GENERATED ALWAYS AS (hex_to_saturation(hex)) STORED,
  lightness  smallint GENERATED ALWAYS AS (hex_to_lightness(hex)) STORED,
  family     text     GENERATED ALWAYS AS (color_family(hex)) STORED,

  temperature_kelvin smallint GENERATED ALWAYS AS (hex_to_temperature(hex)) STORED,
  reach_centimeters  integer
    GENERATED ALWAYS AS (color_reach(hex, roughness, emission)) STORED,
  weight_grams       integer  GENERATED ALWAYS AS (hex_to_weight(hex)) STORED,

  CONSTRAINT color_is_a_color CHECK (kind = 'color'),
  CONSTRAINT color_belongs_to_a_color
    FOREIGN KEY (product_id, kind) REFERENCES product (id, kind) ON DELETE CASCADE,

  CONSTRAINT color_hex_shape CHECK (hex ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT color_roughness_range CHECK (roughness BETWEEN 5 AND 95),
  -- Below 100 nm the layer is thinner than the light it would have to bend, so
  -- nothing sensible lives between bare paint and the first film that shows.
  CONSTRAINT color_coating_range
    CHECK (coating_nanometers = 0 OR coating_nanometers BETWEEN 100 AND 600),
  CONSTRAINT color_emission_range CHECK (emission BETWEEN 0 AND 100),
  -- Interference happens to a reflection, so a surface that scatters its
  -- reflection away has none for a coating to happen in.
  CONSTRAINT color_coating_needs_a_reflection
    CHECK (coating_nanometers = 0 OR roughness <= 40),
  -- Fluorescence is a pigment handing light back in its own band, and a gray
  -- has no band: it would just go white. There is no fluorescent beige.
  CONSTRAINT color_fluorescence_needs_a_band
    CHECK (emission = 0 OR hex_to_saturation(hex) >= 50)
);

CREATE INDEX color_hue_idx ON color (hue);
CREATE INDEX color_saturation_idx ON color (saturation);
CREATE INDEX color_lightness_idx ON color (lightness);
CREATE INDEX color_family_idx ON color (family);
CREATE INDEX color_temperature_idx ON color (temperature_kelvin);
CREATE INDEX color_roughness_idx ON color (roughness);
CREATE INDEX color_coating_idx ON color (coating_nanometers);
CREATE INDEX color_emission_idx ON color (emission);

/* --------------------------------------------------------------- a finisher */

-- A tin puts a finish back onto a color, so it carries the same three amounts a
-- color does, being the finish it applies. It never runs out, so there is
-- nothing here about how long it lasts.
CREATE TABLE finisher (
  product_id uuid         PRIMARY KEY,
  kind       product_kind NOT NULL DEFAULT 'finisher',

  roughness          smallint NOT NULL,
  coating_nanometers smallint NOT NULL,
  emission           smallint NOT NULL,

  grain_micrometers smallint GENERATED ALWAYS AS (finish_grain(roughness)) STORED,
  weight_grams      integer
    GENERATED ALWAYS AS (finisher_weight(roughness, coating_nanometers)) STORED,

  CONSTRAINT finisher_is_a_finisher CHECK (kind = 'finisher'),
  CONSTRAINT finisher_belongs_to_a_finisher
    FOREIGN KEY (product_id, kind) REFERENCES product (id, kind) ON DELETE CASCADE,

  CONSTRAINT finisher_roughness_range CHECK (roughness BETWEEN 5 AND 95),
  CONSTRAINT finisher_coating_range
    CHECK (coating_nanometers = 0 OR coating_nanometers BETWEEN 100 AND 600),
  CONSTRAINT finisher_emission_range CHECK (emission BETWEEN 0 AND 100),
  CONSTRAINT finisher_coating_needs_a_reflection
    CHECK (coating_nanometers = 0 OR roughness <= 40)
);

CREATE INDEX finisher_roughness_idx ON finisher (roughness);
CREATE INDEX finisher_coating_idx ON finisher (coating_nanometers);
CREATE INDEX finisher_emission_idx ON finisher (emission);

/* ---------------------------------------------------------------- a shifter */

CREATE TABLE shifter (
  product_id uuid         PRIMARY KEY,
  kind       product_kind NOT NULL DEFAULT 'shifter',

  direction   shift_direction NOT NULL,
  arc_degrees smallint        NOT NULL,

  torque_millinewton_meters integer
    GENERATED ALWAYS AS (shift_torque(arc_degrees)) STORED,
  backlash_micrometers      integer
    GENERATED ALWAYS AS (shift_backlash(direction, arc_degrees)) STORED,
  weight_grams              integer
    GENERATED ALWAYS AS (shift_weight(direction, arc_degrees)) STORED,

  CONSTRAINT shifter_is_a_shifter CHECK (kind = 'shifter'),
  CONSTRAINT shifter_belongs_to_a_shifter
    FOREIGN KEY (product_id, kind) REFERENCES product (id, kind) ON DELETE CASCADE,

  -- A shifter that turned 0° would not be a shifter.
  CONSTRAINT shifter_arc_range CHECK (arc_degrees BETWEEN 1 AND 360)
);

CREATE INDEX shifter_direction_idx ON shifter (direction);
CREATE INDEX shifter_arc_idx ON shifter (arc_degrees);

/* ------------------------------------------------------- images and reviews */

CREATE TABLE product_image (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid        NOT NULL REFERENCES product (id) ON DELETE CASCADE,
  -- Content-addressed: the name is the SHA-256 of the bytes, so nothing an
  -- uploader controls reaches the filesystem.
  filename   text        NOT NULL,
  alt        text        NOT NULL DEFAULT '',
  position   integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_image_filename_shape
    CHECK (filename ~ '^[a-f0-9]{64}\.(png|jpg|webp)$')
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

/* -------------------------------------------------------------- the listing */

-- One row per product with its variant, its foundry and its rating already
-- joined, so a search reads one relation.
--
-- The three amounts a finish is made of are COALESCEd across the two kinds that
-- have them: a shopper asking for a roughness means it wherever it is, and the
-- database answers from whichever table holds it.
CREATE VIEW product_listing AS
SELECT
  p.id,
  p.slug,
  p.name,
  p.description,
  p.price_cents,
  p.stock_quantity,
  p.kind,
  p.created_at,
  p.search_vector,

  c.hex,
  c.hue,
  c.saturation,
  c.lightness,
  c.family,
  c.temperature_kelvin,
  c.reach_centimeters,

  COALESCE(c.roughness, f.roughness)                   AS roughness,
  COALESCE(c.coating_nanometers, f.coating_nanometers) AS coating_nanometers,
  COALESCE(c.emission, f.emission)                     AS emission,
  f.grain_micrometers,

  s.direction,
  s.arc_degrees,
  s.torque_millinewton_meters,
  s.backlash_micrometers,

  COALESCE(c.weight_grams, f.weight_grams, s.weight_grams) AS weight_grams,

  b.id            AS brand_id,
  b.slug          AS brand_slug,
  b.name          AS brand_name,
  b.search_vector AS brand_search_vector,

  COALESCE(avg(r.rating), 0)::numeric(3, 2) AS rating_average,
  count(r.id)::integer                      AS rating_count
FROM product p
JOIN brand b ON b.id = p.brand_id
LEFT JOIN color c ON c.product_id = p.id
LEFT JOIN finisher f ON f.product_id = p.id
LEFT JOIN shifter s ON s.product_id = p.id
LEFT JOIN product_review r ON r.product_id = p.id
GROUP BY p.id, b.id, c.product_id, f.product_id, s.product_id;

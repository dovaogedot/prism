-- Three categories, and a product that is one of three things.
--
-- The shop used to sell exactly one thing, so `product` could be one flat row.
-- It now sells three, and they have almost nothing in common:
--
--   color      a hex and a finish                    hue, saturation, lightness
--   finisher   puts a finish back onto a color       durability: how many colors
--   shifter    turns a color around the wheel        direction and arc
--
-- Modelled as a tagged union in the table: one `kind` discriminant, one column
-- per variant field, and a CHECK that spells out the exact shape of each
-- variant. A shifter with a hex, or a finisher with no durability, is rejected
-- by the database rather than by a code path somebody has to remember to write.
--
-- Two composite foreign keys do the rest of the work that a CHECK cannot,
-- because a CHECK may not look at another row:
--
--   category (parent_id, kind) -> category (id, kind)   a subtree cannot mix kinds
--   product  (category_id, kind) -> category (id, kind) a product cannot be filed
--                                                       outside its own category
--
-- Both are free: `id` is already unique, so `(id, kind)` costs one index and
-- makes an entire class of wrong data unrepresentable.

/* ------------------------------------------------------------------- types */

CREATE TYPE product_kind AS ENUM ('color', 'finisher', 'shifter');
CREATE TYPE shift_direction AS ENUM ('cw', 'ccw');

/* -------------------------------------------------------------- categories */

-- Everything that exists today is a color, so the default is right for the
-- backfill and wrong as a standing policy — hence dropping it immediately.
ALTER TABLE category ADD COLUMN kind product_kind NOT NULL DEFAULT 'color';
ALTER TABLE category ALTER COLUMN kind DROP DEFAULT;

-- The three roots live here rather than in the seed: they are one per enum
-- label, so they are part of what the schema means, not part of a sample
-- catalog somebody could choose not to load.
INSERT INTO category (slug, name, description, kind, position) VALUES
  ('color', 'Colors',
   'The core business. Sealed at source, sold by the hue, delivered whole.',
   'color', 0),
  ('finisher', 'Finishers',
   'For when a color has gone flat. Puts the surface back on without touching the hue underneath.',
   'finisher', 1),
  ('shifter', 'Shifters',
   'Turns a color you already own into one you would rather have. Sold by the degree, one way or the other.',
   'shifter', 2)
ON CONFLICT DO NOTHING;

-- The seven color families were roots. They are branches of one now.
UPDATE category
   SET parent_id = (SELECT id FROM category WHERE slug = 'color')
 WHERE parent_id IS NULL
   AND slug NOT IN ('color', 'finisher', 'shifter');

ALTER TABLE category
  ADD CONSTRAINT category_id_kind_key UNIQUE (id, kind),
  DROP CONSTRAINT category_parent_id_fkey,
  ADD CONSTRAINT category_parent_shares_kind
    FOREIGN KEY (parent_id, kind) REFERENCES category (id, kind) ON DELETE RESTRICT;

/* ------------------------------------------------------------------ colors */

-- The view reads the columns being retyped and regenerated, so it goes first
-- and comes back at the bottom.
DROP VIEW product_listing;

ALTER TABLE product
  ADD COLUMN kind product_kind NOT NULL DEFAULT 'color';
ALTER TABLE product ALTER COLUMN kind DROP DEFAULT;

ALTER TABLE product
  -- Only a color has these. `hex_to_hue` and friends are STRICT, so the three
  -- channel columns already go NULL on their own once `hex` does.
  ALTER COLUMN hex DROP NOT NULL,
  ALTER COLUMN finish DROP NOT NULL,

  ADD COLUMN durability  integer,
  ADD COLUMN arc_degrees smallint,
  ADD COLUMN direction   shift_direction,

  DROP CONSTRAINT product_category_id_fkey,
  ADD CONSTRAINT product_matches_category_kind
    FOREIGN KEY (category_id, kind) REFERENCES category (id, kind) ON DELETE RESTRICT,

  ADD CONSTRAINT product_durability_positive
    CHECK (durability IS NULL OR durability > 0),
  ADD CONSTRAINT product_arc_range
    CHECK (arc_degrees IS NULL OR arc_degrees BETWEEN 1 AND 360),

  -- The union, written out. Each branch names every variant column, so adding
  -- a fourth kind without deciding what it carries fails here rather than
  -- silently admitting a row with nothing in it.
  ADD CONSTRAINT product_variant_shape CHECK (
    CASE kind
      WHEN 'color' THEN
        hex IS NOT NULL AND finish IS NOT NULL
        AND durability IS NULL AND arc_degrees IS NULL AND direction IS NULL
      WHEN 'finisher' THEN
        hex IS NULL AND finish IS NOT NULL AND durability IS NOT NULL
        AND arc_degrees IS NULL AND direction IS NULL
      WHEN 'shifter' THEN
        hex IS NULL AND finish IS NULL AND durability IS NULL
        AND arc_degrees IS NOT NULL AND direction IS NOT NULL
    END
  );

/* ------------------------------------------------------------ measurements */

-- Temperature, reach and weight were generated from `hex` alone, which now
-- exists on one kind in three. Rather than let two thirds of the catalog have
-- no measurements at all, each kind measures by whatever it actually has —
-- which is the same trick as before, applied to a wider domain.

ALTER TABLE product
  DROP COLUMN temperature_kelvin,
  DROP COLUMN reach_centimeters,
  DROP COLUMN weight_grams;

/*
 * A finisher runs at the temperature of the finish it applies. Fluorescent
 * comes out of the tin hot enough to be an offence in some countries; matte
 * is applied cold and disapprovingly.
 */
CREATE FUNCTION finish_temperature(finish product_finish)
RETURNS smallint
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT (CASE finish
    WHEN 'fluorescent' THEN 8600
    WHEN 'gloss'       THEN 6800
    WHEN 'iridescent'  THEN 6000
    WHEN 'matte'       THEN 4200
  END)::smallint;
$$;

/*
 * A shifter's temperature is where it leaves you, not where it runs: turning
 * clockwise walks toward the reds and warms, counter-clockwise walks toward
 * the blues and cools. The daylight white point is the resting state, as it is
 * for a color with no opinion.
 */
CREATE FUNCTION shift_temperature(arc smallint, direction shift_direction)
RETURNS smallint
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT (6000 + (CASE direction WHEN 'cw' THEN 8 ELSE -8 END) * arc)::smallint;
$$;

/*
 * Dispatch by kind. Not STRICT: a null column is the normal case for two
 * variants out of three, and returning null for the whole product because a
 * shifter has no hex would be exactly backwards.
 *
 * No ELSE on the CASE, so a fourth kind arrives as a null in a NOT NULL column
 * and the insert fails, rather than the shop quietly selling something with no
 * measurements.
 */
CREATE FUNCTION product_temperature(
  kind product_kind,
  hex text,
  finish product_finish,
  arc smallint,
  direction shift_direction
)
RETURNS smallint
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE kind
    WHEN 'color'    THEN hex_to_temperature(hex)
    WHEN 'finisher' THEN finish_temperature(finish)
    WHEN 'shifter'  THEN shift_temperature(arc, direction)
  END;
$$;

/*
 * Reach: how far the thing carries.
 *
 * A color's is its saturation, as before. A finisher's is how many colors it
 * will see you through, at forty centimetres of shelf apiece. A shifter's is
 * its arc, on the reasoning that a tool which swings a color right across the
 * wheel is felt from further away than one that nudges it.
 */
CREATE FUNCTION product_reach(
  kind product_kind,
  hex text,
  finish product_finish,
  durability integer,
  arc smallint
)
RETURNS integer
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE kind
    WHEN 'color'    THEN hex_to_reach(hex, finish)
    WHEN 'finisher' THEN durability * 40
    WHEN 'shifter'  THEN arc * 20
  END;
$$;

/*
 * Weight: how heavy the thing feels in a layout.
 *
 * A color's is its lightness, as before — dark reads heavy. A finisher's is
 * the tin, which gets heavier the more colors it holds. A shifter's is its
 * arc, because nobody has ever described a 300° swing as light work.
 */
CREATE FUNCTION product_weight(
  kind product_kind,
  hex text,
  durability integer,
  arc smallint
)
RETURNS integer
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE kind
    WHEN 'color'    THEN hex_to_weight(hex)
    WHEN 'finisher' THEN round(60 + durability * 3.0)::integer
    WHEN 'shifter'  THEN round(40 + arc * 1.2)::integer
  END;
$$;

ALTER TABLE product
  ADD COLUMN temperature_kelvin smallint NOT NULL
    GENERATED ALWAYS AS (product_temperature(kind, hex, finish, arc_degrees, direction)) STORED,
  ADD COLUMN reach_centimeters integer NOT NULL
    GENERATED ALWAYS AS (product_reach(kind, hex, finish, durability, arc_degrees)) STORED,
  ADD COLUMN weight_grams integer NOT NULL
    GENERATED ALWAYS AS (product_weight(kind, hex, durability, arc_degrees)) STORED;

/* ----------------------------------------------------------------- indexes */

-- The category filter is the first one a shopper touches and it is worth an
-- index on its own; the rest are the same reasoning as the hue index.
CREATE INDEX product_kind_idx ON product (kind);
CREATE INDEX product_arc_idx ON product (arc_degrees);
CREATE INDEX product_temperature_idx ON product (temperature_kelvin);
CREATE INDEX category_kind_idx ON category (kind);

/* -------------------------------------------------------------------- view */

CREATE VIEW product_listing AS
SELECT
  p.id,
  p.slug,
  p.name,
  p.description,
  p.price_cents,
  p.stock_quantity,
  p.kind,
  p.hex,
  p.finish,
  p.hue,
  p.saturation,
  p.lightness,
  p.durability,
  p.arc_degrees,
  p.direction,
  p.temperature_kelvin,
  p.reach_centimeters,
  p.weight_grams,
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

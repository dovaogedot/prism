-- Measurements that belong to a color rather than to a container.
--
-- The shop used to ship colors in vials, so a product carried a stored weight
-- and three stored dimensions — four numbers the seed invented. It sells the
-- color itself now, and a color has its own measurable properties:
--
--   temperature  how warm it burns          hue + saturation  K / °C / °F
--   reach        how far it still reads     saturation        m / ft
--   weight       how heavy it looks         lightness         g / oz
--
-- One HSL channel each, so no two of them are the same fact twice. Every color
-- has all three — there is no color without a hue, and none of these needs a
-- unit of sale to be meaningful.
--
-- All three are GENERATED, which leaves `hex` and `finish` as the only stored
-- facts about a color. The application cannot write any of the rest, and no
-- displayed measurement can disagree with the swatch beside it.

-- The view selects the columns being dropped, so it goes first and comes back
-- at the bottom.
DROP VIEW product_listing;

ALTER TABLE product
  DROP CONSTRAINT product_dimensions_positive,
  DROP COLUMN weight_grams,
  DROP COLUMN length_mm,
  DROP COLUMN width_mm,
  DROP COLUMN height_mm;

/*
 * Warmth, in kelvin.
 *
 * Warmest at orange and coldest at blue, on a cosine so the wheel wraps with
 * no seam at 0°. Saturation is the amplitude: a near-gray collapses toward
 * 6000 K, which is roughly the daylight white point — the right answer for a
 * color with no opinion about temperature.
 *
 * This is a stylized map, not a colorimetric CCT: correlated color temperature
 * is only defined near the Planckian locus, and a saturated green is nowhere
 * near it. What the shop needs is warm/cool, and this gives it for every color.
 */
CREATE FUNCTION hex_to_temperature(hex text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(
    6000 + 4000 * (hex_to_saturation(hex) / 100.0)
                * cos(radians(hex_to_hue(hex) - 210))
  )::smallint;
$$;

/*
 * Reach, in centimeters: how far away the color still reads as itself.
 *
 * Saturation carries it — a vivid color survives distance and a muddy one
 * dissolves into whatever is behind it, which is the whole reason hi-vis
 * clothing is fluorescent rather than merely bright.
 *
 * Finish is the multiplier, and the only place finish shows up in a number:
 * fluorescent re-emits and carries further, matte scatters and gives up first.
 * Centimeters rather than meters so the stored value stays an exact integer.
 */
CREATE FUNCTION finish_reach_factor(finish product_finish)
RETURNS numeric
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT CASE finish
    WHEN 'fluorescent' THEN 1.4
    WHEN 'gloss'       THEN 1.1
    WHEN 'iridescent'  THEN 1.0
    WHEN 'matte'       THEN 0.8
  END;
$$;

CREATE FUNCTION hex_to_reach(hex text, finish product_finish)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(
    (500 + 30000 * (hex_to_saturation(hex) / 100.0)) * finish_reach_factor(finish)
  )::integer;
$$;

/*
 * Visual weight, in grams.
 *
 * Not the mass of anything — the heft a color has in a layout. People judge a
 * dark object heavier than a pale one of identical mass, and designers have
 * been saying "that color is too heavy there" for a century on the strength of
 * it. Black lands near 240 g, an off-white near 30 g.
 */
CREATE FUNCTION hex_to_weight(hex text)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(20 + (100 - hex_to_lightness(hex)) * 2.2)::integer;
$$;

-- NOT NULL is doing real work on `reach_centimeters`: `finish_reach_factor`
-- has one branch per enum label and no ELSE, so adding a fifth finish without
-- deciding how far it carries fails the insert instead of quietly storing NULL.
ALTER TABLE product
  ADD COLUMN temperature_kelvin smallint NOT NULL
    GENERATED ALWAYS AS (hex_to_temperature(hex)) STORED,
  ADD COLUMN reach_centimeters integer NOT NULL
    GENERATED ALWAYS AS (hex_to_reach(hex, finish)) STORED,
  ADD COLUMN weight_grams integer NOT NULL
    GENERATED ALWAYS AS (hex_to_weight(hex)) STORED;

-- Same reasoning as the hue and saturation indexes: materialized so a range
-- over them can be indexed rather than recomputed per row.
CREATE INDEX product_temperature_idx ON product (temperature_kelvin);

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

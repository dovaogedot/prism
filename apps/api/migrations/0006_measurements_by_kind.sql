-- Measurements that belong to the kind, not to the shop.
--
-- 0005 gave all three kinds a temperature, a reach and a weight, on the theory
-- that a measurement is a measurement. It is not: a tin of finisher does not
-- have a reach, and a shifter's "temperature" was a joke stretched past the
-- point of meaning anything. What each kind measures now follows from what it
-- actually is:
--
--   color      temperature  how warm it burns        hue + saturation  K -> °C/°F
--              reach        how far it still reads   saturation + finish  m/ft
--              weight       how heavy it looks       lightness         g/oz
--
--   finisher   coverage     how much it will finish  durability        m²/ft²
--              grain        how coarse it leaves it  finish            µm/mil
--              weight       tin plus contents        finish + durability  g/oz
--
--   shifter    torque       how hard it has to turn  arc               N·m/lbf·ft
--              backlash     the play in the gear     direction + arc   mm/in
--              weight       how heavy the gear is    direction + arc   g/oz
--
-- A color has three independent facts, so it gets three independent
-- measurements. The other two have only two each, so their three are three
-- different functions of those two rather than three separate facts — which is
-- the honest limit of what they carry.
--
-- Everything is stored in the smallest whole unit so the columns stay exact
-- integers; the unit a shopper reads is scaled in @prism/shared, and imperial
-- is derived there too. Nothing about how a product measures is stored.

DROP VIEW product_listing;

ALTER TABLE product
  DROP COLUMN temperature_kelvin,
  DROP COLUMN reach_centimeters,
  DROP COLUMN weight_grams;

DROP FUNCTION product_temperature(product_kind, text, product_finish, smallint, shift_direction);
DROP FUNCTION product_reach(product_kind, text, product_finish, integer, smallint);
DROP FUNCTION product_weight(product_kind, text, integer, smallint);
DROP FUNCTION finish_temperature(product_finish);
DROP FUNCTION shift_temperature(smallint, shift_direction);

/* -------------------------------------------------------------- finishers */

/*
 * Coverage, in square centimetres: how much surface one tin will see through.
 *
 * Durability is the count of colors it will finish, and a color takes about two
 * square metres to do properly — less if you rush it, which we do not
 * recommend and cannot detect.
 */
CREATE FUNCTION finisher_coverage(durability integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT durability * 21000;
$$;

/*
 * Grain, in micrometres: how coarse the surface it leaves is.
 *
 * A real number for real surfaces — roughness is measured in micrometres, or
 * in mils by anyone who buys their tools in inches. Matte leaves the most
 * texture and gloss almost none, which is the whole difference between them.
 */
CREATE FUNCTION finish_grain(finish product_finish)
RETURNS smallint
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT (CASE finish
    WHEN 'matte'       THEN 34
    WHEN 'fluorescent' THEN 21
    WHEN 'iridescent'  THEN 11
    WHEN 'gloss'       THEN 3
  END)::smallint;
$$;

/*
 * Weight, in grams: the tin, plus what is in it.
 *
 * The only measurement here that uses both of a finisher's facts — the tin
 * scales with how many colors it holds, and a coarse finish is heavier per
 * color than a fine one, which is why matte is such a chore to carry.
 */
CREATE FUNCTION finisher_weight(finish product_finish, durability integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(90 + durability * (2.0 + finish_grain(finish) / 20.0))::integer;
$$;

/* --------------------------------------------------------------- shifters */

/*
 * Torque, in millinewton-metres: how hard the mechanism has to work.
 *
 * Linear in the arc, because turning a color twice as far is twice the
 * argument. Stored in thousandths so the column stays an integer; newton-metres
 * is what a shopper reads.
 */
CREATE FUNCTION shift_torque(arc smallint)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT arc * 45;
$$;

/*
 * Backlash, in micrometres: the play in the gear before the color starts to
 * move.
 *
 * The one number that genuinely differs by direction. Every shifter ever built
 * was cut for clockwise; going the other way takes up the slack on the wrong
 * face of the tooth, and you feel it. Widens with the arc, because a longer
 * turn passes through more of the gear.
 */
CREATE FUNCTION shift_backlash(direction shift_direction, arc smallint)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(
    (CASE direction WHEN 'cw' THEN 120 ELSE 420 END) + arc * 1.8
  )::integer;
$$;

/*
 * Weight, in grams: the gear itself.
 *
 * A wider arc needs more of it, and the counter-clockwise models carry an extra
 * plate to take the backlash out — or to take most of it out, at any rate.
 */
CREATE FUNCTION shift_weight(direction shift_direction, arc smallint)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(
    40 + arc * 1.2 + (CASE direction WHEN 'ccw' THEN 65 ELSE 0 END)
  )::integer;
$$;

/* ----------------------------------------------------------------- columns */

-- Each is null for the kinds it does not belong to, and that is what the
-- expression says: `hex_to_*` and the two instrument helpers are all STRICT, so
-- a column goes null exactly when the facts it is made of are absent. Weight
-- is the one every kind has, so it alone dispatches and alone is NOT NULL.
CREATE FUNCTION product_weight(
  kind product_kind,
  hex text,
  finish product_finish,
  durability integer,
  arc smallint,
  direction shift_direction
)
RETURNS integer
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE kind
    WHEN 'color'    THEN hex_to_weight(hex)
    WHEN 'finisher' THEN finisher_weight(finish, durability)
    WHEN 'shifter'  THEN shift_weight(direction, arc)
  END;
$$;

ALTER TABLE product
  -- colors
  ADD COLUMN temperature_kelvin smallint
    GENERATED ALWAYS AS (hex_to_temperature(hex)) STORED,
  ADD COLUMN reach_centimeters integer
    GENERATED ALWAYS AS (hex_to_reach(hex, finish)) STORED,
  -- finishers
  ADD COLUMN coverage_square_centimeters integer
    GENERATED ALWAYS AS (finisher_coverage(durability)) STORED,
  ADD COLUMN grain_micrometers smallint
    GENERATED ALWAYS AS (finish_grain(finish)) STORED,
  -- shifters
  ADD COLUMN torque_millinewton_meters integer
    GENERATED ALWAYS AS (shift_torque(arc_degrees)) STORED,
  ADD COLUMN backlash_micrometers integer
    GENERATED ALWAYS AS (shift_backlash(direction, arc_degrees)) STORED,
  -- everything
  ADD COLUMN weight_grams integer NOT NULL
    GENERATED ALWAYS AS (product_weight(kind, hex, finish, durability, arc_degrees, direction)) STORED;

-- `grain_micrometers` is generated from `finish`, which a finisher and a color
-- both have — so a color gets a grain too, and simply never shows it. The
-- alternative is a CASE on kind in the expression, which would say the same
-- thing twice.

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
  p.coverage_square_centimeters,
  p.grain_micrometers,
  p.torque_millinewton_meters,
  p.backlash_micrometers,
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

-- Extensions, enum types, and every derivation the catalog is built on.
--
-- Nothing a product is measured by, or filed under, is stored: hue, saturation,
-- lightness, temperature, reach, grain, torque, backlash, weight and the color
-- family a shopper searches by are all functions of the few facts a product
-- actually carries. These are IMMUTABLE so Postgres can run them into generated
-- columns, where they carry indexes and answer range facets quickly.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_role AS ENUM ('customer', 'admin');

-- The three things the shop sells, and the discriminant of every product.
CREATE TYPE product_kind AS ENUM ('color', 'finisher', 'shifter');

-- Which way round the wheel a shifter turns.
CREATE TYPE shift_direction AS ENUM ('cw', 'ccw');

/* ----------------------------------------------------------- color, as HSL */

-- One sRGB channel of '#rrggbb' as a 0..1 fraction.
-- Offsets: 2 = red, 4 = green, 6 = blue.
CREATE FUNCTION hex_channel(hex text, channel_offset int)
RETURNS numeric
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT (('x' || substr(hex, channel_offset, 2))::bit(8)::int) / 255.0;
$$;

-- Hue in degrees, 0..359. Achromatic colors report 0.
CREATE FUNCTION hex_to_hue(hex text)
RETURNS smallint
LANGUAGE plpgsql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
DECLARE
  r numeric; g numeric; b numeric;
  mx numeric; mn numeric; chroma numeric; hue numeric;
BEGIN
  r := hex_channel(hex, 2);
  g := hex_channel(hex, 4);
  b := hex_channel(hex, 6);

  mx := greatest(r, g, b);
  mn := least(r, g, b);
  chroma := mx - mn;

  IF chroma = 0 THEN
    RETURN 0;
  ELSIF mx = r THEN
    hue := 60 * mod((g - b) / chroma, 6);
  ELSIF mx = g THEN
    hue := 60 * (((b - r) / chroma) + 2);
  ELSE
    hue := 60 * (((r - g) / chroma) + 4);
  END IF;

  IF hue < 0 THEN
    hue := hue + 360;
  END IF;

  RETURN (round(hue)::int % 360)::smallint;
END;
$$;

-- HSL lightness as a percentage, 0..100.
CREATE FUNCTION hex_to_lightness(hex text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(
    (
      greatest(hex_channel(hex, 2), hex_channel(hex, 4), hex_channel(hex, 6))
      + least(hex_channel(hex, 2), hex_channel(hex, 4), hex_channel(hex, 6))
    ) / 2 * 100
  )::smallint;
$$;

-- HSL saturation as a percentage, 0..100.
CREATE FUNCTION hex_to_saturation(hex text)
RETURNS smallint
LANGUAGE plpgsql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
DECLARE
  r numeric; g numeric; b numeric;
  mx numeric; mn numeric; chroma numeric; lightness numeric;
BEGIN
  r := hex_channel(hex, 2);
  g := hex_channel(hex, 4);
  b := hex_channel(hex, 6);

  mx := greatest(r, g, b);
  mn := least(r, g, b);
  chroma := mx - mn;

  IF chroma = 0 THEN
    RETURN 0;
  END IF;

  lightness := (mx + mn) / 2;

  -- chroma / (1 - |2L - 1|) is mathematically <= 1; clamp against rounding.
  RETURN least(100, greatest(0,
    round(chroma / (1 - abs(2 * lightness - 1)) * 100)::int
  ))::smallint;
END;
$$;

/* -------------------------------------------------- color, as a family name */

-- Which family a color belongs to: the nearest of a fixed set of landmarks in
-- RGB space, which partitions the cube into one Voronoi cell per name.
--
-- Nothing files a color under a name. "Gold" is a point, every color is a
-- point, and the answer is whichever point is closest — so adding a color says
-- only what the color is, and searching for "gold" asks for a region rather
-- than for a label somebody remembered to attach.
--
-- Distance is plain Euclidean over the three channels, which is what makes the
-- partition a Voronoi diagram of RGB rather than of anything else.
CREATE FUNCTION color_family(hex text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT landmark.family
  FROM (VALUES
    ('red',     214,  40,  40),
    ('orange',  232,  89,  12),
    ('gold',    212, 160,  23),
    ('yellow',  245, 224,  80),
    ('lime',    140, 198,  63),
    ('green',    46, 158,  79),
    ('teal',     23, 162, 162),
    ('blue',     37,  99, 235),
    ('violet',  124,  58, 237),
    ('magenta', 214,  36, 159),
    ('pink',    240, 138, 176),
    ('brown',   122,  75,  42),
    ('maroon',  110,  25,  35),
    ('navy',     25,  40, 110),
    ('olive',   110, 110,  40),
    ('cream',   240, 232, 205),
    ('black',    20,  20,  26),
    ('gray',    138, 138, 143),
    ('white',   242, 242, 240)
  ) AS landmark(family, r, g, b)
  ORDER BY
    (landmark.r - hex_channel(hex, 2) * 255) ^ 2
    + (landmark.g - hex_channel(hex, 4) * 255) ^ 2
    + (landmark.b - hex_channel(hex, 6) * 255) ^ 2
  LIMIT 1;
$$;

/* ------------------------------------------------ what each kind measures */

-- Correlated color temperature in kelvin: warm hues burn hot, and the more
-- saturated the color the further from neutral it sits.
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

-- How heavy a color looks, in grams. Dark reads heavy.
CREATE FUNCTION hex_to_weight(hex text)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(20 + (100 - hex_to_lightness(hex)) * 2.2)::integer;
$$;

-- How far a color still reads as itself, in centimeters. Saturation carries it,
-- a smooth surface throws it further, and a glow carries further still.
CREATE FUNCTION color_reach(hex text, roughness smallint, emission smallint)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(
    (500 + 30000 * (hex_to_saturation(hex) / 100.0))
      * (1.35 - roughness / 130.0)
      * (1.0 + emission / 120.0)
  )::integer;
$$;

-- How much texture a surface is left with, in micrometers. Roughness measured
-- in the unit a machinist would measure it in.
CREATE FUNCTION finish_grain(roughness smallint)
RETURNS smallint
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(roughness * 0.37)::smallint;
$$;

-- How far the glow a finisher leaves still carries, in centimeters. A finisher sold for
-- emission changes no texture and lays down no film, so this is the one
-- dimension it has.
CREATE FUNCTION emission_reach(emission smallint)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(120 + emission * 34.0)::integer;
$$;

-- What a finisher weighs, in grams: a fixed base, plus the solids it carries to
-- do the one thing it does. Not STRICT, because two of the three arguments are absent
-- on every finisher — that is what says which one it is.
CREATE FUNCTION finisher_weight(
  roughness smallint,
  coating_nanometers smallint,
  emission smallint
)
RETURNS integer
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT round(
    180 + COALESCE(finish_grain(roughness) * 3.0, 0)
        + COALESCE(coating_nanometers * 0.25, 0)
        + COALESCE(emission * 1.4, 0)
  )::integer;
$$;

-- How hard a shifter has to turn, in millinewton-meters.
CREATE FUNCTION shift_torque(arc smallint)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT arc * 45;
$$;

-- The play in the gear before the color starts to move, in micrometers.
CREATE FUNCTION shift_backlash(direction shift_direction, arc smallint)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(
    (CASE direction WHEN 'cw' THEN 120 ELSE 420 END) + arc * 1.8
  )::integer;
$$;

-- What the gear itself weighs, in grams.
CREATE FUNCTION shift_weight(direction shift_direction, arc smallint)
RETURNS integer
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT round(
    40 + arc * 1.2 + (CASE direction WHEN 'ccw' THEN 65 ELSE 0 END)
  )::integer;
$$;

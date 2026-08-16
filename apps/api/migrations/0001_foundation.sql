-- Extensions, enum types, and the color maths.
--
-- Hue, saturation and lightness are properties OF a hex value, not independent
-- facts, so the application never computes or writes them. These IMMUTABLE
-- functions let Postgres derive them into generated columns, where they can
-- carry B-tree indexes and answer range facets quickly.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_role AS ENUM ('customer', 'admin');

CREATE TYPE product_finish AS ENUM ('matte', 'gloss', 'iridescent', 'fluorescent');

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

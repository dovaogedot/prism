-- A property value that counts rooms reads "1 room" or "<n> rooms", whatever case and plural it was written in, as the seed plants it, so a filter lists each count once.
UPDATE "product_property"
SET "value" = CASE
  WHEN substring("value" FROM '^(\d+) ') = '1' THEN '1 room'
  ELSE substring("value" FROM '^(\d+) ') || ' rooms'
END
WHERE "value" ~* '^\d+ rooms?$';

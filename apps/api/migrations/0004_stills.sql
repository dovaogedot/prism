-- A product's pictures under each theme, and which of them an admin uploaded.
--
-- A color's slab and a finisher's room are rendered to stills from several
-- angles, once under each theme, and those stills are the product's images.
-- A photograph an admin uploads reads the same under both themes.

-- The picture under the dark theme. A photograph names its one file twice.
ALTER TABLE product_image ADD COLUMN dark_filename text;

UPDATE product_image SET dark_filename = filename;

ALTER TABLE product_image
  ALTER COLUMN dark_filename SET NOT NULL,
  ADD CONSTRAINT product_image_dark_filename_shape
    CHECK (dark_filename ~ '^[a-f0-9]{64}\.(png|jpg|webp)$');

-- Every image that was not uploaded is one of the product's stills, and the
-- seed replaces those whenever the build it runs in rendered different ones.
ALTER TABLE product_image ADD COLUMN uploaded boolean NOT NULL DEFAULT false;

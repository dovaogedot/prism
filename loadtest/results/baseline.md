### The baseline run

| Users | Requests | Requests/s | Steps/s | p50 | p90 | p95 | p99 | Errors | Steps successful |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | 480 | 3.8 | 2.5 | 6 ms | 15 ms | 25 ms | 31 ms | 0.00% | 100.00% |

Containers:

| Container | Peak CPU (100% is one core) | Peak memory | Of its limit |
| --- | --- | --- | --- |
| prism-load-api-1 | 16% | 190.9MiB | 19% of 1GiB |
| prism-load-k6-run-332ec54edbe6 | 3% | 17.78MiB | 0% of 15.54GiB |
| prism-load-mailpit-1 | 3% | 28.61MiB | 0% of 15.54GiB |
| prism-load-postgres-1 | 5% | 194.5MiB | 19% of 1GiB |
| prism-load-rabbitmq-1 | 272% | 209.6MiB | 1% of 15.54GiB |
| prism-load-stats-1 | 0% | 28.88MiB | 0% of 15.54GiB |
| prism-load-web-1 | 5% | 24.62MiB | 0% of 15.54GiB |

Costliest statements:

| Calls | Total ms | Mean ms | Statement |
| --- | --- | --- | --- |
| 60 | 93 | 1.55 | `select "slug", "name", "price_cents", ( SELECT json_build_object($4, i.id, $5, i.file, $6, i.alt, $7, i.width, $8, i.height, $9, i.is_pixel_art) FROM product_im` |
| 15 | 36 | 2.42 | `select "product_property"."name", "product_property"."value", count(*) filter (where $2) from "product_property" inner join "product" on "product_property"."pro` |
| 20 | 34 | 1.72 | `select "product_property"."name", "product_property"."value", count(*) filter (where "product"."rating_average" * $4 >= $1) from "product_property" inner join "` |
| 15 | 29 | 1.95 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 15 | 29 | 1.94 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 20 | 28 | 1.41 | `select "brand"."slug", "brand"."name", count(*) filter (where "product"."rating_average" * $4 >= $1) from "product" inner join "category" on "product"."category` |
| 20 | 28 | 1.38 | `select min("product"."price_cents"), max("product"."price_cents") from "product" inner join "category" on "product"."category_id" = "category"."id" inner join "` |
| 20 | 27 | 1.37 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 20 | 27 | 1.36 | `select "product"."rating_average", count(*) filter (where $3) from "product" inner join "category" on "product"."category_id" = "category"."id" inner join "bran` |
| 7 | 26 | 3.65 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |

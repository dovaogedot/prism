### The peak run

| Users | Requests | Requests/s | Steps/s | p50 | p90 | p95 | p99 | Errors | Steps successful |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 50 | 11491 | 37.1 | 24.9 | 4 ms | 8 ms | 10 ms | 26 ms | 0.00% | 100.00% |

Containers:

| Container | Peak CPU (100% is one core) | Peak memory | Of its limit |
| --- | --- | --- | --- |
| prism-load-api-1 | 28% | 222.9MiB | 22% of 1GiB |
| prism-load-k6-run-46e96de4c45f | 10% | 51.43MiB | 0% of 15.54GiB |
| prism-load-mailpit-1 | 3% | 36MiB | 0% of 15.54GiB |
| prism-load-postgres-1 | 22% | 218.1MiB | 21% of 1GiB |
| prism-load-rabbitmq-1 | 270% | 213.8MiB | 1% of 15.54GiB |
| prism-load-stats-1 | 2% | 8.789MiB | 0% of 15.54GiB |
| prism-load-web-1 | 11% | 37.99MiB | 0% of 15.54GiB |

Costliest statements:

| Calls | Total ms | Mean ms | Statement |
| --- | --- | --- | --- |
| 1049 | 2141 | 2.04 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 1049 | 2095 | 2.00 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 1049 | 1958 | 1.87 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 1521 | 1787 | 1.17 | `select "slug", "name", "price_cents", ( SELECT json_build_object($4, i.id, $5, i.file, $6, i.alt, $7, i.width, $8, i.height, $9, i.is_pixel_art) FROM product_im` |
| 171 | 494 | 2.89 | `select "product_property"."name", "product_property"."value", count(*) filter (where $2) from "product_property" inner join "product" on "product_property"."pro` |
| 446 | 405 | 0.91 | `select "product_property"."name", "product_property"."value", count(*) filter (where "product"."rating_average" * $4 >= $1) from "product_property" inner join "` |
| 111 | 388 | 3.50 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 106 | 384 | 3.62 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 102 | 370 | 3.63 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 171 | 286 | 1.67 | `select "product"."rating_average", count(*) filter (where $2) from "product" inner join "category" on "product"."category_id" = "category"."id" inner join "bran` |

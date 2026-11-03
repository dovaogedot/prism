### The normal run

| Users | Requests | Requests/s | Steps/s | p50 | p90 | p95 | p99 | Errors | Steps successful |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | 4548 | 14.6 | 9.8 | 5 ms | 9 ms | 11 ms | 25 ms | 0.00% | 100.00% |

Containers:

| Container | Peak CPU (100% is one core) | Peak memory | Of its limit |
| --- | --- | --- | --- |
| prism-load-api-1 | 17% | 207.9MiB | 20% of 1GiB |
| prism-load-k6-run-a057cba04b56 | 6% | 30.5MiB | 0% of 15.54GiB |
| prism-load-mailpit-1 | 3% | 32.61MiB | 0% of 15.54GiB |
| prism-load-postgres-1 | 10% | 216.2MiB | 21% of 1GiB |
| prism-load-rabbitmq-1 | 284% | 214.5MiB | 1% of 15.54GiB |
| prism-load-stats-1 | 1% | 8.969MiB | 0% of 15.54GiB |
| prism-load-web-1 | 6% | 31.59MiB | 0% of 15.54GiB |

Costliest statements:

| Calls | Total ms | Mean ms | Statement |
| --- | --- | --- | --- |
| 426 | 888 | 2.09 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 426 | 881 | 2.07 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 426 | 792 | 1.86 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 573 | 671 | 1.17 | `select "slug", "name", "price_cents", ( SELECT json_build_object($4, i.id, $5, i.file, $6, i.alt, $7, i.width, $8, i.height, $9, i.is_pixel_art) FROM product_im` |
| 147 | 393 | 2.67 | `select "product_property"."name", "product_property"."value", count(*) filter (where $2) from "product_property" inner join "product" on "product_property"."pro` |
| 147 | 222 | 1.51 | `select "product"."rating_average", count(*) filter (where $2) from "product" inner join "category" on "product"."category_id" = "category"."id" inner join "bran` |
| 147 | 203 | 1.38 | `select "brand"."slug", "brand"."name", count(*) filter (where $2) from "product" inner join "category" on "product"."category_id" = "category"."id" inner join "` |
| 55 | 198 | 3.59 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 147 | 189 | 1.28 | `select min("product"."price_cents"), max("product"."price_cents") from "product" inner join "category" on "product"."category_id" = "category"."id" inner join "` |
| 184 | 137 | 0.74 | `select "product_property"."name", "product_property"."value", count(*) filter (where "product"."rating_average" * $4 >= $1) from "product_property" inner join "` |

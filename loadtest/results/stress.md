### The stress run

| Users | Requests | Requests/s | Steps/s | p50 | p90 | p95 | p99 | Errors | Steps successful |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3000 | 617702 | 420.6 | 273.6 | 147 ms | 2186 ms | 3218 ms | 7134 ms | 0.00% | 99.83% |

Containers:

| Container | Peak CPU (100% is one core) | Peak memory | Of its limit |
| --- | --- | --- | --- |
| prism-load-api-1 | 182% | 344MiB | 34% of 1GiB |
| prism-load-k6-run-48aed6bdad1d | 218% | 2.099GiB | 14% of 15.54GiB |
| prism-load-mailpit-1 | 23% | 38.1MiB | 0% of 15.54GiB |
| prism-load-postgres-1 | 209% | 224.3MiB | 22% of 1GiB |
| prism-load-rabbitmq-1 | 294% | 185.4MiB | 1% of 15.54GiB |
| prism-load-stats-1 | 1% | 9.301MiB | 0% of 15.54GiB |
| prism-load-web-1 | 93% | 602MiB | 4% of 15.54GiB |

Costliest statements:

| Calls | Total ms | Mean ms | Statement |
| --- | --- | --- | --- |
| 82173 | 111854 | 1.36 | `select "slug", "name", "price_cents", ( SELECT json_build_object($4, i.id, $5, i.file, $6, i.alt, $7, i.width, $8, i.height, $9, i.is_pixel_art) FROM product_im` |
| 54220 | 109823 | 2.03 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 54220 | 105601 | 1.95 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 54220 | 104392 | 1.93 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 5574 | 25441 | 4.56 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 5511 | 24252 | 4.40 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 5187 | 23828 | 4.59 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 7320 | 21638 | 2.96 | `select "product_property"."name", "product_property"."value", count(*) filter (where $2) from "product_property" inner join "product" on "product_property"."pro` |
| 27391 | 12873 | 0.47 | `select "product"."id", "product"."slug", "product"."name", "product"."price_cents", "product"."stock", "category"."slug", "category"."name", "brand"."slug", "br` |
| 9631 | 8071 | 0.84 | `select "product_property"."name", "product_property"."value", count(*) filter (where "product"."rating_average" * $4 >= $1) from "product_property" inner join "` |

Step by step:

| Stage | p95 | Errors |
| --- | --- | --- |
| Ramp to 25 | 11 ms | 0.00% |
| Held at 25 | 10 ms | 0.00% |
| Ramp to 50 | 9 ms | 0.00% |
| Held at 50 | 9 ms | 0.00% |
| Ramp to 100 | 9 ms | 0.00% |
| Held at 100 | 10 ms | 0.00% |
| Ramp to 150 | 9 ms | 0.00% |
| Held at 150 | 10 ms | 0.00% |
| Ramp to 200 | 9 ms | 0.00% |
| Held at 200 | 10 ms | 0.00% |
| Ramp to 300 | 10 ms | 0.00% |
| Held at 300 | 10 ms | 0.00% |
| Ramp to 400 | 11 ms | 0.00% |
| Held at 400 | 10 ms | 0.00% |
| Ramp to 500 | 11 ms | 0.00% |
| Held at 500 | 12 ms | 0.00% |
| Ramp to 600 | 12 ms | 0.00% |
| Held at 600 | 13 ms | 0.00% |
| Ramp to 800 | 14 ms | 0.00% |
| Held at 800 | 18 ms | 0.00% |
| Ramp to 1000 | 25 ms | 0.00% |
| Held at 1000 | 39 ms | 0.00% |
| Ramp to 1250 | 346 ms | 0.00% |
| Held at 1250 | 741 ms | 0.00% |
| Ramp to 1500 | 1202 ms | 0.00% |
| Held at 1500 | 2003 ms | 0.00% |
| Ramp to 2000 | 2631 ms | 0.00% |
| Held at 2000 | 4771 ms | 0.00% |
| Ramp to 2500 | 5009 ms | 0.00% |
| Held at 2500 | 7185 ms | 0.00% |
| Ramp to 3000 | 7404 ms | 0.00% |
| Held at 3000 | 9762 ms | 0.00% |

The most users a held minute served with p95 under 5 seconds and errors under 5%: 2000.

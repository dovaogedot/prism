# Seed

Placeholder data for the shop. The application never imports from this folder, and the
stack starts without it. `./start.sh` runs the seed once the shop is up, and `./start.sh seed`
(`.\start.cmd seed` on Windows) runs it alone. On the server, the Seed workflow runs it,
started by hand from the Actions tab.

| Path | What it is |
| --- | --- |
| `seed.ts` | Fills an empty catalog: a demo shopper, reviewers, and the products of `catalog.json`. A database that already holds products is left alone. |
| `seed-catalog.ts` | The shape of `catalog.json`. |
| `data.zip` | The data: `catalog.json` with the products, and `media/` with one picture each. No image contains it. |
| `catalog.json`, `media/` | The data unpacked. Git ignores them. |
| `archive.ts` | Packs the unpacked data into `data.zip`, and unpacks it. |
| `fetch/` | The tools that write `catalog.json` and `media/` from their sources. |
| `tests/` | Unit tests of the code above. They run with the API's unit tests. |

The seed needs only Docker and no network. When `catalog.json` is missing it first unpacks
`data.zip` into this folder. Then it plants the data.

The data is the items of three games: Balatro (from the Balatro wiki), The Binding of Isaac
(from tboi.com) and Minecraft (from the Minecraft wiki). The pictures and texts belong to the
games' makers and stand in as placeholder data. Stock, sizes and reviews come from a fixed
random seed, so the same data always plants the same shop.

## Commands on a host with Node

Run them in `apps/api`, after `npm ci`.

```sh
node seed/fetch/fetch-catalog.ts    # writes catalog.json and media/ again from the sources
node seed/fetch/check-margins.ts    # checks that every picture in a category keeps the same margin
node seed/archive.ts pack           # packs them into data.zip, the archive the seed unpacks
```

## Another shop

Pack a `catalog.json` and a `media/` of the same shape into `data.zip`. Nothing else
changes: the filters come from the products' properties.

# Seed

Placeholder data for the shop. The application never imports from this folder, and the stack starts without it. `./start.sh` runs the seed once the shop is up, and `./start.sh seed` (`.\start.cmd seed` on Windows) runs it alone. On the server, the Seed workflow runs it, started by hand from the Actions tab.

| Path | What it is |
| --- | --- |
| `seed.ts` | Fills an empty catalog in one transaction: a demo shopper, reviewers, and the products of `catalog.json`. Only the demo shopper has a password; the reviewers have none and live on the reserved `.example` domain. A database that already holds products keeps its catalog: the seed only makes the smaller copies of any picture that lacks them, and moves reviewers an earlier seed made on real mail domains with a password to their `.example` addresses, with no password and no live session. |
| `seed-catalog.ts` | The shape of `catalog.json`. |
| `review-texts.ts` | The titles, openings, details and closings the seeded reviews are built from, by star rating. |
| `data.zip` | The data: `catalog.json` with the products, and `media/` with one picture each. No image contains it. |
| `catalog.json`, `media/` | The data unpacked. Git ignores them. |
| `archive.ts` | Packs the unpacked data into `data.zip`, and unpacks it. |
| `fetch/` | The tools that write `catalog.json` and `media/` from their sources. |
| `tests/` | Unit tests of the code above. They run with the API's unit tests. |

The seed needs only Docker and no network. When `catalog.json` is missing it first unpacks `data.zip` into this folder. Then it plants the data.

The data is the items of three games: Balatro (from the Balatro wiki), The Binding of Isaac (from tboi.com) and Minecraft (from the Minecraft wiki). The pictures and texts belong to the games' makers and stand in as placeholder data. Stock, sizes and reviews come from a fixed random seed, so the same data always plants the same shop.

## Commands on a host with Node

Run them in `apps/api`, after `npm ci && npm run build` at the repository root: the build makes the shared package the tools import.

```sh
node seed/fetch/fetch-catalog.ts    # writes catalog.json and media/ again from the sources
node seed/fetch/check-margins.ts    # checks that every picture in a category keeps the same margin
node seed/archive.ts pack           # packs them into data.zip, the archive the seed unpacks
```

## Another shop

Pack a `catalog.json` and a `media/` of the same shape into `data.zip`. Nothing else changes: the filters come from the products' properties.

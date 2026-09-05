# Prism

**A business-to-consumer storefront that sells colors.** Not paint — colors. Each SKU is a
single hue, sold as itself: `Screaming Pumpkin`, `Municipal Beige`, `Void Black`. Brands
are pigment foundries.

There are three categories, and they have almost nothing in common:

| Category | What it is | What it carries |
| --- | --- | --- |
| **Colors** | A color, sold whole | A hex, and three amounts of finish |
| **Finishers** | Puts a finish back on a color you own | The same three amounts, being the finish it applies |
| **Shifters** | Turns a color you own into a different one | A direction round the wheel, and an arc in degrees |

The unusual product turns out to be a good fit for the requirements. A color has real
numeric attributes — hue angle, saturation, lightness — which makes faceted search
genuinely interesting rather than a brand checkbox, and it means the swatch images can be
generated at seed time instead of committed as binaries. A finisher and a shifter have no
image at all: the grid draws them from their own spec, so there is nothing on disk that
could disagree with the numbers beside it.

Three categories with disjoint attributes is the interesting modeling problem here, and it
is solved the normalized way: a `product` table for what all three share, and a `color`,
`finisher` and `shifter` table for what they do not. Every column in those three is NOT
NULL, because a column only exists where it applies — there is no `hex` on a shifter to be
null. Each keys back to `product (id, kind)` rather than to `product (id)`, so a color row
attached to a shifter is rejected by the database rather than by a code path somebody has to
remember to write. [`spec.ts`](apps/api/src/modules/catalog/spec.ts) is the one place that
turns the joined row back into a discriminated union, after which nothing downstream sees a
null.

The required weight and dimensions belong to the thing itself rather than to a container,
because there is no container — and what there is to measure follows from what the thing is:

| | Colors | Finishers | Shifters |
| --- | --- | --- | --- |
| | **Temperature** how warm it burns · °C / °F | **Coating** the layer it lays down · nm / µin | **Torque** how hard it has to turn · N·m / lbf·ft |
| | **Reach** how far away it still reads · m / ft | **Grain** how much texture it leaves · µm / mil | **Backlash** the play before the color moves · mm / in |
| | **Coating** the interference layer over it · nm / µin | | |
| | **Weight** how heavy it looks · g / oz | **Weight** the tin and its contents · g / oz | **Weight** the gear itself · g / oz |

Weight is the one all three share, because the requirement names it and because everything
in the shop has some. The coating is shared by two, because the layer a tin lays down is the
layer a color wears. Otherwise a kind measures exactly what it carries — a tin never runs
out, so there is nothing to measure about how long it lasts.

The coating is where the two systems stop being the same number under a different name. It
is a layer a few hundred nanometers thick, which is below the mil every other surface in the
shop is quoted in, so the imperial half drops three decimal places to the **microinch** —
25.4 nm, the same ratio as the mil, and the unit an inch-shop measures a coating in.

Every one is a generated column, so `hex`, the three finish amounts, `arc_degrees` and
`direction` are the only stored facts about any product. Kelvin is what the temperature
column holds, being the unit the derivation is defined in, and nothing displays it: "6208 K"
describes a light source rather than a color.

**Every word resolves against what a product is.** Adding a color says what the color *is*,
and nothing else — no taxonomy, no label, no shelf chosen by hand.
`shifters` is a category, `cw` and `clock-wise` are a direction, `matte` is a stretch of the
roughness axis, and `gold` is a point in RGB space — every color belongs to the landmark
nearest it, which partitions the color cube into one Voronoi cell per name. `color_family`
holds those landmarks and a generated column holds the answer, so the family is indexed and
countable without anyone having decided that this particular color is a gold.

This is **Project 1 (Foundation)**: accounts, the database, and the catalog.

---

## Running it

**Docker is the only prerequisite.** No Node, no Postgres, no accounts anywhere.

```bash
./start.sh
```

That builds the images, starts the stack, sets up the database, seeds the catalog —
every color with its swatch image, and the finishers and shifters beside them — and
waits until the storefront answers.

| Service | URL |
| --- | --- |
| Storefront | <http://localhost:3000> |
| API documentation | <http://localhost:3000/api/docs> |
| Inbox (Mailpit) | <http://localhost:8025> |

Two accounts are seeded, both with the password `colors are not paint`:

| Email | Role |
| --- | --- |
| `admin@prism.test` | admin |
| `shopper@prism.test` | customer |

```bash
./start.sh down     # stop
./start.sh reset    # stop and delete the volumes
```

### Why it needs no secrets

CAPTCHA and OAuth would normally need a Google Cloud account, which would make "Docker is
the only prerequisite" false. Both default to a mode that works offline:

- **CAPTCHA** renders the genuine reCAPTCHA widget using Google's published always-pass
  test key pair. The widget is real and the server-side check is real; the key is the one
  Google provides for exactly this situation.
- **OAuth** runs the full authorization-code flow — for both Google and GitHub — against a
  consent screen this API serves itself. The redirect, the `state` check, the code
  exchange, the profile lookup and the account linking are all real; only the identity
  provider is local. Each provider signs its own authorization codes, so a code minted for
  one is rejected by the other, exactly as two real providers behave.

Set real credentials in `.env` and the same code paths verify against the real thing:

```ini
CAPTCHA_MODE=google
RECAPTCHA_SITE_KEY=...
RECAPTCHA_SECRET_KEY=...

OAUTH_MODE=live
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

In `live` mode a provider is offered only when **both** halves of its credential pair are
set, so configuring GitHub alone is a valid setup — the sign-in page asks
`GET /auth/oauth/providers` and renders only the buttons that can actually work.

Authorized redirect URIs:

```text
http://localhost:3000/api/v1/auth/oauth/google/callback
http://localhost:3000/api/v1/auth/oauth/github/callback
```

Two-factor is enforced on **every** path. A provider proves who owns the third-party
account, not that the second factor this account asked for was satisfied — and since a
provider reporting a matching verified address links itself, that is not a bar the owner
controls. An OAuth sign-in into an account with TOTP lands on the same challenge page
password sign-in uses, with the token in an httpOnly cookie rather than the URL.

Password-reset email goes to the **Mailpit** container, a local inbox at
<http://localhost:8025> — not to a real address. Set `SMTP_HOST`, `SMTP_USER`,
`SMTP_PASSWORD` and `SMTP_SECURE` in `.env` to send through a real relay.

The GitHub app needs the `read:user` and `user:email` scopes. Without `user:email` the
emails endpoint returns 403 and any account with a private address cannot sign in at
all — GitHub's `/user` returns `email: null` for those, which is the default for many
accounts.

### Tests

```bash
npm test              # everything
npm run test:unit     # the fast ones only
npm run test:e2e      # Playwright, against the running stack
npm run typecheck
```

The integration tests start a real Postgres via Testcontainers, so Docker must be running.
The end-to-end specs drive a real browser and expect `./start.sh` to have been run first.

---

## Entity relationship diagram

Cardinality is on the connector; modality is in the notes beneath.

```mermaid
erDiagram
    APP_USER ||--o{ OAUTH_IDENTITY : "signs in with"
    APP_USER ||--o{ SESSION : "opens"
    APP_USER ||--o{ PASSWORD_RESET_TOKEN : "requests"
    APP_USER ||--o{ PRODUCT_REVIEW : writes
    SESSION  ||--|{ REFRESH_TOKEN : "rotates through"

    BRAND    ||--o{ PRODUCT : produces
    PRODUCT  ||--o| COLOR : "is a"
    PRODUCT  ||--o| FINISHER : "is a"
    PRODUCT  ||--o| SHIFTER : "is a"
    PRODUCT  ||--o{ PRODUCT_IMAGE : "is shown by"
    PRODUCT  ||--o{ PRODUCT_REVIEW : "is rated by"

    APP_USER {
        uuid        id              PK "gen_random_uuid()"
        text        email           UK "lowercase, CHECK enforced"
        text        password_hash   "NULL for OAuth-only accounts"
        user_role   role            "customer | admin"
        text        totp_secret     "NULL until 2FA setup begins"
        timestamptz totp_enabled_at "NULL until a live code confirms it"
        timestamptz created_at
    }

    OAUTH_IDENTITY {
        uuid        id       PK
        uuid        user_id  FK
        text        provider UK "unique with subject"
        text        subject  UK "provider's immutable id, never the email"
        timestamptz created_at
    }

    SESSION {
        uuid        id             PK "carried in the access token as sid"
        uuid        user_id        FK
        timestamptz expires_at
        timestamptz revoked_at     "NULL while live"
        text        revoked_reason "logout | token_reuse | password_reset"
        text        user_agent
        text        ip_address
        timestamptz created_at
    }

    REFRESH_TOKEN {
        uuid        id         PK
        uuid        session_id FK "the rotation family"
        text        token_hash UK "SHA-256; the token itself is never stored"
        timestamptz used_at    "NULL until spent; non-NULL twice means replay"
        timestamptz expires_at
        timestamptz created_at
    }

    PASSWORD_RESET_TOKEN {
        uuid        id         PK
        uuid        user_id    FK
        text        token_hash UK
        timestamptz used_at    "NULL until spent; single use"
        timestamptz expires_at
        timestamptz created_at
    }

    BRAND {
        uuid     id            PK
        text     slug          UK
        text     name
        text     description
        tsvector search_vector "GENERATED"
    }

    PRODUCT {
        uuid         id             PK
        text         slug           UK
        text         name
        text         description
        integer      price_cents    "CHECK >= 0"
        integer      stock_quantity "CHECK >= 0"
        uuid         brand_id       FK
        product_kind kind           "the discriminant: color | finisher | shifter"
        tsvector     search_vector  "GENERATED, name weighted above description"
        timestamptz  created_at
    }

    COLOR {
        uuid     product_id         PK "FK with kind, so it can only be a color"
        text     hex                "CHECK matches #rrggbb"
        smallint roughness          "5 mirror .. 95 chalk"
        smallint coating_nanometers "interference layer, or 0 for bare paint"
        smallint emission           "how hard it glows, or 0"
        smallint hue                "GENERATED from hex"
        smallint saturation         "GENERATED from hex"
        smallint lightness          "GENERATED from hex"
        text     family             "GENERATED; nearest landmark in RGB space"
        smallint temperature_kelvin "GENERATED"
        integer  reach_centimeters  "GENERATED"
        integer  weight_grams       "GENERATED"
    }

    FINISHER {
        uuid     product_id         PK "FK with kind, so it can only be a finisher"
        smallint roughness          "the surface it leaves"
        smallint coating_nanometers "the layer it lays down, or 0"
        smallint emission           "the glow it leaves, or 0"
        smallint grain_micrometers  "GENERATED from roughness"
        integer  weight_grams       "GENERATED"
    }

    SHIFTER {
        uuid            product_id                PK "FK with kind, so it can only be a shifter"
        shift_direction direction                 "cw | ccw"
        smallint        arc_degrees               "CHECK between 1 and 360"
        integer         torque_millinewton_meters "GENERATED"
        integer         backlash_micrometers      "GENERATED"
        integer         weight_grams              "GENERATED"
    }

    PRODUCT_IMAGE {
        uuid        id         PK
        uuid        product_id FK
        text        filename   "SHA-256 of the bytes plus extension"
        text        alt
        integer     position
        timestamptz created_at
    }

    PRODUCT_REVIEW {
        uuid        id         PK
        uuid        product_id FK "unique with user_id: one review each"
        uuid        user_id    FK
        smallint    rating     "CHECK between 1 and 5"
        text        body
        timestamptz created_at
    }
```

**Modality.** Every foreign key above is mandatory. A `session` need not have a
`revoked_at`; a `refresh_token` need not have a `used_at`; an `app_user` need not have a
`password_hash` (OAuth-only) or a `totp_secret` (2FA off). Each of those is mapped to an
`Option` at the repository boundary, so nothing above that layer sees a `null`.

Nothing in `color`, `finisher` or `shifter` is nullable, because a column only exists in the
table it applies to. There is no `hex` on a shifter to be null and no CHECK constraint
standing in for a shape the tables already have. What the database does have to say is that
a variant row belongs to a product of its own kind, and a plain foreign key on `product_id`
cannot say it — so the key is composite:

```sql
CREATE TABLE color (
  product_id uuid         PRIMARY KEY,
  kind       product_kind NOT NULL DEFAULT 'color',
  …
  CONSTRAINT color_is_a_color CHECK (kind = 'color'),
  FOREIGN KEY (product_id, kind) REFERENCES product (id, kind) ON DELETE CASCADE
);
```

`product` carries `UNIQUE (id, kind)` for those three keys to point at. A color row attached
to a shifter is rejected by the database rather than by a code path somebody has to remember
to write.

**Cardinality.** A session has *at least one* refresh token (`||--|{`) — it is created
with its first one in the same transaction, because a session with no token is unusable.
Everything else is zero-or-more.

### One view, no stored aggregates

There is no `rating_avg` or `rating_count` column. A view owns the aggregation and every
catalog read goes through it:

```sql
CREATE VIEW product_listing AS
SELECT p.*, b.name AS brand_name,
       c.hex, c.family, s.direction, s.arc_degrees,
       COALESCE(c.roughness, f.roughness)                       AS roughness,
       COALESCE(c.weight_grams, f.weight_grams, s.weight_grams) AS weight_grams,
       COALESCE(AVG(r.rating), 0)::numeric(3,2) AS rating_average,
       COUNT(r.id)::integer                     AS rating_count
FROM product p
JOIN brand b ON b.id = p.brand_id
LEFT JOIN color c ON c.product_id = p.id
LEFT JOIN finisher f ON f.product_id = p.id
LEFT JOIN shifter s ON s.product_id = p.id
LEFT JOIN product_review r ON r.product_id = p.id
GROUP BY p.id, b.id, c.product_id, f.product_id, s.product_id;
```

The view is also where a search stops caring which table a column lives in. The three finish
amounts are `COALESCE`d across the two kinds that have them, so one filter on roughness
finds it wherever it is.

A displayed rating therefore cannot disagree with the reviews it came from. If aggregation
ever costs too much, `CREATE MATERIALIZED VIEW` is the only word that changes — no
application code moves.

The same principle appears three times with three mechanisms:

| Derived value | Mechanism | Why that one |
| --- | --- | --- |
| Ratings | SQL view | Aggregates across rows; only the database can |
| Hue / saturation / lightness | `GENERATED ALWAYS … STORED` | Must be **indexable** for range faceting, so it has to be materialized — but Postgres owns the derivation, not the app |
| Color family | `GENERATED ALWAYS … STORED` | Same reason: searching for "gold" is a `WHERE family = 'gold'` against an index, and nobody ever files a color under a name |
| Temperature / reach / weight | `GENERATED ALWAYS … STORED` | Same reason, and it leaves the variant columns as the only stored facts about any product |
| Imperial units | Pure TypeScript function | Presentation only; never filtered or sorted on |

Every measurement lives in the table of the kind that has it, generated from that kind's own
columns. Weight is the one all three carry, and each derives its own: a color's from its
lightness, a tin's from the solids it must hold, a gear's from its arc. Nothing dispatches on
`kind` any more, because nothing has to.

Each is stored in the smallest whole unit — centimeters, millinewton-meters, micrometers,
nanometers — so the columns stay exact integers. Scaling to a readable unit is presentation,
and happens in `@prism/shared` alongside the imperial conversion.

---

## Architecture

A **modular monolith** with ports and adapters inside. One deployable API, split into
modules that own their tables. Projects 2 and 3 arrive as new modules, not a rewrite.

```text
apps/api/src/
  main.ts        process entry: config, database, listen, graceful shutdown
  app.ts         the composition root — the only file that knows which
                 adapter implements which port
  config.ts      environment parsed once by Zod; a bad container dies at boot
  platform/      ports and their adapters
                 clock · hasher · tokens · mailer · captcha · oauth · storage · cache
  http/          errors · cookies · guard
  modules/
    auth/        routes | service | repository | emails | mock-consent
    catalog/     routes | service | repository | search
  db/            schema · migrate · seed · palette · swatch

packages/shared/ Option · Result · units · color · errors · Zod contracts
apps/web/        React SPA
```

Services never import a concrete adapter. They receive `{ clock, hasher, tokens, repo }` as
an argument, which is what lets the tests run the real logic against a fake clock and an
in-memory mailer, and what lets `createAuthService` be reused wherever its adapters are
supplied.

### The stack

| Layer | Choice |
| --- | --- |
| Runtime | Node 26 — runs TypeScript directly via native type stripping, so the API has **no build step** |
| Language | TypeScript 7 (the native compiler), `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` |
| HTTP | Fastify 5 with `fastify-type-provider-zod` |
| Database | PostgreSQL 18, Drizzle ORM 0.45, hand-written SQL migrations |
| Errors | `neverthrow` `Result<T, DomainError>` — no `throw` in domain code |
| Matching | `ts-pattern`, including all JSX conditionals |
| Frontend | React 19, Vite 8, Tailwind 4, React Router 8 (data mode), TanStack Query |
| Web server | Caddy |
| Tests | Vitest 4, `fastify.inject`, Testcontainers |

### Types carry the rules

`packages/shared` defines the vocabulary the whole codebase speaks:

```ts
type Option<A> = { _tag: "Some"; value: A } | { _tag: "None" }

type DomainError =
  | { _tag: "InvalidCredentials" }
  | { _tag: "RefreshTokenReused" }
  | { _tag: "ValidationFailed"; issues: readonly ValidationIssue[] }
  | …
```

The repository layer is the only place that sees a nullable column. Every service returns
`Result<T, DomainError>`, and the HTTP layer maps the error tag to a status code through a
`Record<DomainErrorTag, number>` — a record keyed by the tag union is exhaustive by
construction, so **adding an error variant is a compile error until every layer handles
it**.

There are no `as` casts anywhere in the codebase. `unknown` appears only in type
predicates at genuine parse boundaries — JWT payloads, Fastify's error handler, OAuth
provider responses, and the `grecaptcha` global — where the value really is unknown until
checked.

### Drawing a color

A color has two stored facts, and a flat rectangle of hex states only one of them. The other
is three **amounts**, rolled independently, because a real surface is several things at once:

| Amount | Range | What it means, and what the slab does |
| --- | --- | --- |
| `roughness` | 5–95 | How scattered the surface is. Low is lacquered: a clearcoat over the pigment returns the strip lamp as a broad soft band. High is chalk — no band at all, a sheen lobe, and visible relief. Matte and gloss are the two ends of this one axis, which is why they share it |
| `coating` | 0, or 100–600 nm | The thickness of a transparent interference layer over the paint. Not a color and not an arc: the thickness *is* the color, and everything the layer does follows from it |
| `emission` | 0, or 35–100 | How hard the pigment gives off its own light, on top of the light it returns rather than instead of it |

None of the three says what the color *is*. A color can be lacquered and iridescent at once,
which real paint routinely is. The four words are still how the shop talks about itself, but
they are **readings** of the numbers rather than values anything stores: `dominantFinish`
picks whichever shows most strongly, each measured as a fraction of its own range, for the
one word a screen reader is given, and `FINISH_BANDS` runs the other way so that typing
"gloss" into the search box lands somewhere sensible.

The rail asks about the amounts instead, one at a time, because they are three different
questions: a roughness is a percentage, a coating is a thickness in nanometers and a glow is
neither. Picking one brings its own slider and nothing else. Matte and gloss are *not* two
of the three — they are the two ends of the first one, so the roughness slider spans the
whole axis and a shopper drags toward whichever end they mean, rather than the shop picking
the point where one word becomes the other.

Picking an amount is itself a filter for two of the three, and this falls out of what the
amounts are rather than being a rule on top of them. A coating and a glow are things a
surface either has or has not got, so their ranges start where having one begins and asking
about a coating is asking for the things that carry one. Every surface has a roughness, so
asking about that narrows nothing and the slider does all the work.

The three counts overlap, and are meant to: a coated color has a roughness as well and is
counted under both, so the three sum to more than the shelf holds. Each is counted with
every finish filter dropped, the range included, or picking one would show the other two
holding nothing.

A finisher carries the same three, being the finish it puts back. There is no such thing as
*the* gloss finisher: one tin leaves a surface at 20 and the next at 15, and a shopper who
wants the second is not served by being sold the first.

[`surfaces.ts`](apps/web/src/features/catalog/artwork/surfaces.ts) is where those amounts
become rendering parameters, and every one of its outputs is a **continuous** function of
its input: two colors a point apart render a point apart. That is the property the unit
tests are built around, because a band anywhere in that function is a place where a filter
returns two colors whose pictures disagree about what they are.

**One WebGL context draws the whole page.** A browser will not hand a dozen contexts to one
document, so there is exactly one renderer, one scene, one slab and one material — with
every shader feature it can use switched on permanently at a value near zero, because
three's program key is built from which of them are above zero and a material that turned
one off between two colors would compile a second shader mid-scroll. Only one stage is ever
under the pointer; the others are still pictures holding whatever was last drawn on them.

**The room is a room.** A gloss face is a picture of its surroundings, so a scene with
lights and nothing to reflect renders as plastic. `PMREMGenerator` convolves a small scene
of bright panels — including the strip, on the same line as the real one, because it is the
same lamp — into the environment every material samples. On top of that: a key light for
shape and a soft shadow; a `RectAreaLight` for the strip itself; and a hemisphere light for
fill, which contributes irradiance and no highlight of its own.

Where that lamp goes is not a matter of taste. A flat face reflects whatever is directly
behind the viewer and spans about seven degrees of that reflection, so a lamp further round
than that cannot appear on a slab standing square on at any brightness — which would leave a
lacquered color reading as matte in a grid nobody has hovered.

**Fluorescence is absorption and re-emission**, so a pigment that fluoresces is an ordinary
lit surface that also adds: it keeps its shading, its highlight and its edges, and its own
band comes back stronger than it went in. Two things follow. The albedo is that band at full
strength — a pigment fluoresces in a narrow band and returns nearly all of it, which is why
one is never dark whatever hue it is sold as. And a pigment with no band has none to hand
back: gray does not glow gray, it goes white, so an emission is only allowed on a hex
saturated enough to have a band, and `product_fluorescence_needs_a_band` says so in the
database rather than in a comment.

The amount is a claim about brightness, so it is spent as luminance and not as energy. A
saturated yellow at the top of its band carries four times the luminance of a saturated
violet at the top of its, and `emissiveScale` divides that out — without it an emission of
60 is legible on the top half of the wheel and does nothing on the bottom. Measured on one
violet with the glow switched off and on: the same face reads 93 mean luminance against 159,
a lift of seven tenths.

**The spill has a ceiling.** A bloom is the display admitting it has run out of range, and
one wide enough to reach the wall says instead that the room is that color — the background
takes the pigment's hue, the slab loses its edge, and a shelf of glowing colors is painful
to look at. So the radius is small and the strength smaller, and the bound is checked rather
than eyeballed: in the dark room the background behind every glowing color stays under 20%
lightness, against a non-glowing control that sits around 8%. In the lit room, where the
wall is gray to begin with, what is bounded is color rather than brightness: the background
stays under 12% saturation, so it stays the gray it was.
[`catalog-artwork.spec.ts`](e2e/specs/catalog-artwork.spec.ts) measures every card on the
shelf and fails on either.

**Neutral tone mapping, because the color is the product.** ACES is the usual default and it
desaturates exactly the saturated colors this shop is selling. Under Khronos PBR Neutral,
which compresses highlights and leaves the rest alone, a face turned to the camera comes
back within single digits of 255 per channel of the hex it is sold under, measured across
every color whose finish is its surface. A coating is meant to disagree, because a layer
that handed back the paint's own color would not be a coating; so is a glow, because a
pigment that makes its own light is brighter than the hex it is mixed from.

**The coating is a real layer, and its thickness is the whole model.** Light coming back off
the top of the layer meets light coming back off the paint underneath, having gone twice
through it; the wavelengths that arrive in step are the ones you see, and which those are
depends on the thickness, the refractive index and the angle. Nothing about the color is
stored, because nothing about it is a separate fact — three.js implements
[Belcour and Barla's](https://belcour.github.io/blog/research/publication/2017/05/01/brdf-thin-film.html)
thin-film model and is handed the one number the shop sells.

Two things follow from taking that seriously, and both were found by rendering rather than
by reasoning. The layer is **titanium dioxide**, index 2.4, which is what every interference
pigment ever sold is actually built from — a layer whose index matched the paint under it
would be no layer at all, and a first attempt at an oil-like 1.45 over a 1.5 base rendered
as bare paint, correctly and uselessly. And a coating needs a **reflection to happen in**, so
`product_coating_needs_a_reflection` keeps every coated surface smooth: interference over
chalk is invisible, and a shop that sold it would be charging for nothing.

Swept on one near-black slab, the color walks the series a soap film walks — 100 nm warm
brown, 175 nm olive, 250 nm cyan, 325 nm magenta, 400 nm green — and starts again paler each
time it passes another order, which is why the range stops at 600. Turning the slab from one
side to the other swings the hue by 15–36°, measured across four coatings. A saturated
pigment shows much less of any of this than a dark one does, because interference lives in
the reflection and a bright pigment's own color is louder than it.


The split is the same one the rest of the codebase uses.
[`tilt.ts`](apps/web/src/features/catalog/artwork/tilt.ts) and `surfaces.ts` are arithmetic,
pure and unit-tested and unaware that a GPU exists; `scene.ts` is the one file in the
feature that is not referentially transparent, because a GPU context is a resource rather
than a value. The component between them owns a canvas, turns the pointer into an angle, and
runs the frames — none of it through React state, because re-rendering a card's subtree
sixty times a second to move a number no React tree reads is not what React is for.

A browser with no WebGL2 gets the flat swatch instead, and so does one whose "GPU" is really
the CPU: building the rig costs about a second and a half on a software renderer and every
stage another eighty milliseconds, which is a worse page than a grid of flat swatches that
arrives at once.

---

## The four explainers

### JWT, and its three parts

A JSON Web Token is three base64url segments separated by dots.

**Header** — the algorithm and type: `{"alg":"HS256","typ":"JWT"}`.

**Payload** — the claims. Ours carries the registered claims `iss`, `aud`, `iat`, `nbf`,
`exp`, `sub`, `jti`, plus `sid` (the session) and `role`:

```json
{
  "sub": "8f2c…", "sid": "b41e…", "role": "customer", "jti": "c7a9…",
  "iss": "prism", "aud": "access",
  "iat": 1786116800, "nbf": 1786116800, "exp": 1786117700
}
```

**Signature** — `HMAC-SHA256(base64url(header) + "." + base64url(payload), secret)`.

The critical property is that a JWT is **signed, not encrypted**. Anyone holding one can
read the payload; the signature only proves it has not been altered. That is why the
payload holds an opaque user id and nothing else — no email, no password hash, nothing
worth reading. A unit test asserts the exact key set, so a future field cannot slip in
unnoticed.

Verification pins the algorithm to `HS256`. Without that, a token claiming `alg: none`
would be accepted as valid with no signature at all — the classic JWT bypass. There is a
test for it.

`aud` separates token kinds. The 2FA challenge token is signed with the same key, so
without an audience check it would be usable as an access token. Both directions are
tested.

### ACID, and where each property earns its place

**Atomicity** — a session and its first refresh token are inserted in one transaction. A
session with no token cannot be used; a token with no session cannot be verified. Either
both exist or neither does.

**Consistency** — the schema refuses invalid states rather than trusting the application:
`hex ~ '^#[0-9a-f]{6}$'`, `rating BETWEEN 1 AND 5`, `price_cents >= 0`,
`email = lower(email)`, and `totp_enabled_at IS NULL OR totp_secret IS NOT NULL` — 2FA
cannot be switched on without a secret to check codes against. Generated columns cannot be
written at all; the integration suite asserts that an `UPDATE product SET hue = 999` is
rejected.

**Isolation** — this one is worth the detail, because the obvious answer is wrong.

Refresh rotation must be single-use: presenting a spent token means somebody holds a copy,
and the whole session should die. The transaction takes `SELECT … FOR UPDATE` on the token
row, marks it used, and inserts its successor.

The instinct is to run it `SERIALIZABLE`. **That breaks the requirement.** Under
`SERIALIZABLE`, the second of two concurrent refreshes cannot see the row version the first
one just committed, so it aborts with a serialization failure — turning a detectable replay
into a retryable error and losing the revocation entirely.

Under the default `READ COMMITTED`, the blocked transaction re-reads the row after the lock
is released, observes `used_at` already set, and deterministically detects the replay. The
row lock already provides the ordering; the *weaker* isolation level is what lets the second
request see what the first one did. Picking the strongest-sounding level would have defeated
the mechanism it was meant to protect.

**Durability** — Postgres commits to the WAL before acknowledging, and the data directory
is a named Docker volume, so a `docker compose down` and back up finds every account and
order intact. Only `./start.sh reset` removes it.

### Postgres, and how it scales from here

*Reads* scale first and cheapest: streaming replicas take the catalog traffic, which is
almost all of it, while writes stay on the primary. The application is already ready for
this — every catalog read goes through one view and one repository, so a read/write split
is a connection-string change in `platform/`, not a refactor.

*Connections* are the usual first wall, since each Postgres backend is a process. PgBouncer
in transaction mode fronts it; the pool size is already configuration
(`DATABASE_POOL_SIZE`).

*Indexes* carry the current query shapes: GIN on three `tsvector` columns for search, GIN
`gin_trgm_ops` for typeahead, B-tree on `price_cents`, `hue` and `saturation` for range
facets, and a partial index `WHERE revoked_at IS NULL` for the session guard's hot path,
which runs on every authenticated request.

*Caching* is two layers. An in-process TTL cache holds facet counts and product detail; `Cache-Control` and `ETag` let Caddy and the browser stop asking. A single
API container makes an in-process cache strictly better than Redis — same semantics, no
network hop, no extra service. It stops being correct at two containers, which is what the
`Cache<A>` port is for: a Redis adapter is a new file behind the same interface.

*Partitioning* is the far end, and only for tables that grow without bound, such as
`product_review`, which is naturally range-partitioned by `created_at`.

The catalog itself does not grow the way order history does, which is why the above is a
path rather than a plan: picking a partition key before the traffic has taken a shape is
guessing.

### Testing

Three layers with deliberately different costs, plus a suite in a real browser.

*Unit* — pure functions and injected fakes, no I/O, ~1 second. `Option` combinators
and their laws; metric↔imperial conversion; WCAG luminance and contrast; every Zod schema
across valid, invalid and boundary input; JWT generation, validation and expiration against
a controllable clock; the TTL cache's expiry and eviction order; image type detection
against disguised payloads; the search and facet SQL builders, asserting on generated SQL
and bound parameters; the PNG encoder; the seeded PRNG and `hslToHex`; the seam where
the product table's nullable columns become a discriminated union, including every shape
the variant constraint forbids; and the arithmetic and tables behind the artwork, pinned by
their relationships rather than by their tuned constants — the pointer turns the slab away
from the finger and gets there at the same speed whatever the framerate; a lacquer thins as
the pigment under it coarsens and is gone by chalk; the arc a color is sold with is the arc
its coating actually shows; the grain tile wraps, because a slab with a seam down its
face is a slab with a mistake on it; and, the one that matters most, every parameter moves
by a hair for a color that differs by a point, because a band anywhere in that function is a
place where two colors a filter returned together disagree about what they are.

*API integration* — the real application over a real Postgres from Testcontainers,
driven through `fastify.inject` so routing, schema validation, guards and serialization all
run. Assertions read rows back rather than trusting the response: that the password was
hashed, that the refresh token is stored only as a digest, that a replay set
`revoked_reason = 'token_reuse'`.

*Security* — SQL injection through every filter, sort and auth field; XSS payloads
stored and read back; JWT tampering (wrong key, `alg: none`, edited payload, wrong issuer,
invented session); mass assignment of `role`; path traversal through the media route;
oversized, malformed, wrongly-typed and deeply-nested bodies; rate limiting.

Note the asymmetry in the injection tests. Slug-shaped parameters are *rejected* — they
have a known shape, so anything else is malformed. The free-text search term is *accepted*
and returns zero results, because it is genuinely free text and the protection is
parameterization rather than a blocklist. A blocklist that rejected `O'Brien's Red` would
be a worse product and no safer.

*End-to-end* — Playwright against the running stack, for the things that only exist in
a browser: that the filter rail does not reflow, that dragging the hue ring works, that the
rail offers each category only the controls that category has, and that the auth routes send
you where they should — including that signing in lands on the catalog rather than the
account page, which depends on a redirect and a form navigation resolving in the same tick.

The signed-in specs share one browser context on purpose, and the comment saying so is
worth reading: handing a saved refresh cookie to several parallel contexts is a replay, and
replay detection revokes the session — the suite tripping over its own security is not a
result worth having.

**Manual tests**, run before each review because they involve a human or a third party:
the CAPTCHA renders and gates registration; Google and GitHub OAuth complete against real
credentials with `OAUTH_MODE=live`, including a GitHub account whose email is set to
private; and 2FA enrollment is scanned with a real authenticator app, the QR read from a
phone rather than a fixture.

The suite covers what the type system cannot: a cache key that collides when a search term
contains `&`, a null byte in a search term producing a 500, Drizzle wrapping Postgres errors
so every duplicate email reports a generic conflict, and `X-Frame-Options` defaulting to
`SAMEORIGIN`.

---

## The API

Everything is under `/api/v1`. OpenAPI 3.1 is generated from the same Zod schemas that
validate the requests and is browsable at `/api/docs`.

### Auth

| Endpoint | Purpose |
| --- | --- |
| `POST /auth/register` | Email, password, CAPTCHA |
| `POST /auth/login` | Answers `authenticated` or `two_factor_required` |
| `POST /auth/login/2fa` | Completes a challenge |
| `POST /auth/refresh` | Rotates the refresh cookie, single-use |
| `POST /auth/logout` | Revokes the session |
| `GET  /auth/me` | The signed-in user |
| `POST /auth/password/forgot` | Always 204 |
| `POST /auth/password/reset` | Single-use token; ends every session |
| `POST /auth/2fa/setup` · `/enable` · `/disable` | TOTP enrollment |
| `GET  /auth/oauth/providers` | Which third-party sign-ins are live |
| `GET  /auth/oauth/:provider` + callback | Authorization-code flow (`google`, `github`) |

### Catalog

| Endpoint | Purpose |
| --- | --- |
| `GET /products` | Search, filter, sort, page — with facet counts |
| `GET /products/suggest` | Typeahead |
| `GET /products/:slug` | One product, with its variant spec and both unit systems |
| `POST /admin/products/:slug/images` | Upload, admin only |
| `GET /media/:filename` | Serve a swatch |

```text
GET /api/v1/products
  ?q=screaming            full-text across product and brand, plus a substring
                          match on the product's own name — so "red" also finds
                          "Powdered"

  &category=color         one of color | finisher | shifter, and the only
                          filter that decides which of the rest apply
  &family=gold            the color family, which is the landmark in RGB space
                          a color is nearest to. Colors only, and derived —
                          nothing is filed under one
  &brands=cyan-and-sons   comma-separated, multi-select
  &priceMin=1000&priceMax=5000
  &minRating=4

  colors and finishers — the finish one has, or the finish the other leaves:
  &finish=coating         which of the three amounts is being asked about, one
                          of roughness | coating | emission
  &roughnessMin=5&roughnessMax=40      matte at one end, gloss at the other
  &coatingMin=100&coatingMax=600       nanometers of interference layer
  &emissionMin=35&emissionMax=100      how hard it gives off its own light

  colors only:
  &hueMin=340&hueMax=20   an arc through 0° — where the reds live
  &saturationMin=60&saturationMax=100
  &lightnessMin=0&lightnessMax=40

  shifters only:
  &arcMin=90&arcMax=270   how far round it turns a color
  &direction=cw|ccw

  &sort=relevance|price_asc|price_desc|rating
  &page=1&perPage=12
```

A product comes back with `category` and `spec.kind` holding the same value. That is
deliberate rather than an oversight: the required data model names a `category` field, and
`spec` is the discriminated union everything downstream matches on, so `category` is built
from `spec.kind` and the two cannot drift. `images` is the whole gallery, ordered, and
`primaryImage` is the first of it — a caller that needs one image takes that and never
reasons about an empty array. A finisher and a shifter are drawn from their own spec, so
their gallery is empty rather than absent.

Facet counts are computed against every filter *except* the dimension being counted, so
ticking a second brand widens the result rather than emptying it. The category dimension
drops more than its own filter: it drops every filter only one kind can satisfy. Counting
how many *colors* satisfy an arc would answer zero, for a reason that has nothing to do
with the question — so those filters leave with the category that owns them, which is also
what the rail does when you switch.

---

## How the security requirements are met

**Access tokens live in memory.** A module-level variable in the SPA — never
`localStorage`, never `sessionStorage`, never a cookie. There is nothing for an injected
script to read and nothing that survives the tab closing. What survives a reload is the
httpOnly refresh cookie, which script cannot touch either; the app trades it for a fresh
access token on boot.

**Refresh rotation is single-use with replay detection.** Every refresh issues a new token
and marks the old one spent. Presenting a spent token revokes the entire session — not just
that token — because a token presented twice means somebody has a copy. The integration
suite proves the legitimate holder is locked out too, which is the point: the account owner
is meant to notice.

**Both token types are revocable.** The access token carries its session id as `sid`, and
the guard checks that session is still live on every request. Logging out kills a valid,
unexpired JWT *immediately* rather than within fifteen minutes. That is one indexed
primary-key lookup per request, and it is the honest price of revocable stateless tokens.

**Tokens are stored as digests.** Refresh and reset tokens are opaque 256-bit random
strings; only their SHA-256 is stored. A database leak yields digests, not credentials.

**Sign-in does not leak account existence.** A wrong password and an unknown address return
byte-identical responses, and an unknown address still performs a real argon2 verification
against a decoy hash so the timing matches. Password reset always answers 204.

**Passwords are argon2id** at the OWASP minimum (19 MiB, 2 iterations). The policy follows
NIST SP 800-63B: a 12-character minimum and a denylist, no composition rules — those mostly
teach people to write `Password1!`.

**Uploads are identified by content.** The file type comes from magic bytes, not the
filename or the declared `Content-Type`, and the stored filename is the SHA-256 of the
bytes — so nothing an uploader controls ever reaches the filesystem.

**Validation runs on both sides from one definition.** The Zod schemas in
`packages/shared` are simultaneously the server validator, the OpenAPI spec, and the
client-side form rules. There is one place to change a rule and no way for the two sides to
drift.

---

## The storefront

`role` is part of the schema and the admin API is role-gated, so an admin screen is a
screen rather than a schema change.

The storefront is built for the catalog rather than for a design system. It is
responsive, keyboard-navigable, and honors `prefers-reduced-motion` and
`prefers-color-scheme`, with a light/dark toggle that overrides the system preference —
blue accents in daylight, yellow after dark, and near-neutral chrome throughout so that the
only vivid things on the page are the products. Where effort has gone into the interface it
has gone into showing a product honestly, which for a color means the artwork above.

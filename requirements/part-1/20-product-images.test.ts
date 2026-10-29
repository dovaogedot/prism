/**
 * REQUIREMENTS_1.md: "Product images are stored with proper file handling and
 * basic serving functionality."
 *
 * Serving is the web server's: the checks read its configuration, and the
 * upload checks find each picture's URL as a file in the media directory it
 * serves.
 */

import { randomBytes } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
import { Staff, type TestAccount } from "../../apps/api/tests/support/staff.ts"

let harness: Harness
let contentManager: TestAccount
let productId: string

/** A picture as the product answers it. */
type Picture = { url: string; width: number; height: number; sources: { width: number; url: string }[] }

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500 }])
  contentManager = await Staff.account(harness, "content@example.com", ["content_manager"])
  productId = await Shop.productId(harness, "desk-lamp")
})

/** Uploads `bytes` as `filename` through the admin's product page, as a multipart form. */
const upload = (bytes: Buffer, filename: string, type: string) => {
  const boundary = `prism${randomBytes(8).toString("hex")}`

  const field = (name: string, value: string) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)

  return harness.app.inject({
    method: "POST",
    url: `/api/v1/admin/products/${productId}/images`,
    headers: { authorization: `Bearer ${contentManager.accessToken}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      field("alt", "A brass desk lamp"),
      field("isPixelArt", "false"),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  })
}

/** The file a `/media/...` URL names in the media directory. */
const resolveMediaFile = (url: string): string => join(harness.mediaDirectory, url.replace(/^\/media\//, ""))

const listMediaFiles = async (): Promise<string[]> =>
  (await readdir(harness.mediaDirectory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)

const makePhoto = () =>
  sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .png()
    .toBuffer()

describe("an uploaded product picture", () => {
  it("is stored as a picture file, with smaller copies, under the URLs the product answers", async () => {
    const uploaded = await upload(await makePhoto(), "lamp.png", "image/png")
    const product = jsonOf(await harness.app.inject({ method: "GET", url: "/api/v1/products/desk-lamp" }))
    const [picture] = product["images"] as Picture[]
    if (picture === undefined) {
      throw new Error(`The product has no picture: ${JSON.stringify(product)}`)
    }

    expect(uploaded.statusCode).toBe(201)
    expect(picture).toMatchObject({ width: 900, height: 600 })
    expect(picture.url).toMatch(/^\/media\//)
    expect(await sharp(await readFile(resolveMediaFile(picture.url))).metadata()).toMatchObject({ width: 900, height: 600 })

    for (const source of picture.sources) {
      expect(source.url).toMatch(/^\/media\//)
      expect((await sharp(await readFile(resolveMediaFile(source.url))).metadata()).width).toBe(source.width)
    }
  })

  it("is refused when it is not a picture, whatever it calls itself, and nothing is stored", async () => {
    const text = await upload(Buffer.from("this is not a picture at all"), "lamp.png", "image/png")
    const svg = await upload(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      "lamp.svg",
      "image/svg+xml",
    )

    expect(text.statusCode).toBe(415)
    expect(svg.statusCode).toBe(415)
    expect(await listMediaFiles()).toEqual([])
    expect(await harness.database.sql`SELECT id FROM product_image`).toHaveLength(0)
  })
})

describe("serving the pictures", () => {
  const readRepositoryFile = (path: string): Promise<string> => readFile(new URL(`../../${path}`, import.meta.url), "utf8")

  it("is the web server's: it answers /media/ from the volume the API writes the files to", async () => {
    const compose = await readRepositoryFile("docker-compose.yml")
    const caddyfile = await readRepositoryFile("apps/web/Caddyfile")

    /** The lines of one service in the compose file, up to the next service. */
    const findService = (name: string): string => new RegExp(`^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}\\w|^\\S)`, "m").exec(compose)?.[1] ?? ""

    const mediaDirectory = /^ {6}MEDIA_DIR: (\S+)$/m.exec(findService("api"))?.[1]

    expect(mediaDirectory).toBeDefined()
    expect(findService("api")).toContain(`- media:${String(mediaDirectory)}\n`)
    expect(findService("web")).toMatch(/source: media\n\s+target: \/media\n\s+read_only: true\n/)
    expect(caddyfile).toMatch(/handle_path \/media\/\* \{\s+root \* \/media\n[\s\S]*?file_server\n\t\}/)
  })
})

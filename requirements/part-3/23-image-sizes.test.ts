/**
 * REQUIREMENTS_3.md: "Product images are stored and served in multiple sizes
 * to support different views (e.g., thumbnails, full-size images)."
 *
 * The API stores the files and names them in what it serves; the web server
 * sends the files themselves from the media volume.
 */

import { randomBytes } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import { join } from "node:path"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
import { Staff, type TestAccount } from "../../apps/api/tests/support/staff.ts"

let harness: Harness
let admin: TestAccount

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500 }])
  admin = await Staff.account(harness, "admin@example.com", ["admin"])
})

type Picture = { url: string; width?: number; height?: number; alt: string; sources: { width: number; url: string }[] }

/** Uploads a `width` by `height` JPEG photograph of the desk lamp as the admin. */
const upload = async (width: number, height: number) => {
  const bytes = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .toBuffer()
  const boundary = `prism${randomBytes(8).toString("hex")}`
  const field = (name: string, value: string) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
  const body = Buffer.concat([
    field("alt", "A brass desk lamp, switched on"),
    field("isPixelArt", "false"),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lamp.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])

  return harness.app.inject({
    method: "POST",
    url: `/api/v1/admin/products/${await Shop.productId(harness, "desk-lamp")}/images`,
    headers: { authorization: `Bearer ${admin.accessToken}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  })
}

/** The file a `/media/` address names, as it lies in the media directory. */
const fileOf = (url: string): string => join(harness.mediaDirectory, url.replace(/^\/media\//, ""))

describe("a product picture", () => {
  it("is stored at its full size and as smaller copies whose files have the widths they are listed with", async () => {
    const response = await upload(2000, 1500)
    const [picture] = jsonOf(response)["images"] as Picture[]

    expect(response.statusCode).toBe(201)
    expect(picture).toMatchObject({ width: 2000, height: 1500 })
    expect(picture?.sources.map((source) => source.width)).toEqual([160, 400, 800, 1600])

    const full = await sharp(await readFile(fileOf(picture?.url ?? ""))).metadata()
    expect([full.width, full.height]).toEqual([2000, 1500])

    for (const source of picture?.sources ?? []) {
      const copy = await sharp(await readFile(fileOf(source.url))).metadata()

      expect([copy.format, copy.width], source.url).toEqual(["webp", source.width])
    }
  })

  it("is never enlarged: a small picture gets only the copies narrower than itself", async () => {
    const [picture] = jsonOf(await upload(500, 500))["images"] as Picture[]

    expect(picture?.sources.map((source) => source.width)).toEqual([160, 400])
    await expect(access(fileOf(picture?.url ?? ""))).resolves.toBeUndefined()
  })

  it("is served with the full-size address and every smaller copy, for the shop's pages to choose from", async () => {
    await upload(2000, 1500)

    const product = jsonOf(await Shop.call(harness, "GET", "/products/desk-lamp"))
    const listed = jsonOf(await Shop.call(harness, "GET", "/products?q=desk"))["items"] as { images: Picture[] }[]
    const [picture] = product["images"] as Picture[]

    expect(picture).toMatchObject({ url: expect.stringMatching(/^\/media\//), width: 2000, alt: "A brass desk lamp, switched on" })
    expect(picture?.sources.map((source) => source.width)).toEqual([160, 400, 800, 1600])
    expect(picture?.sources.every((source) => source.url.startsWith("/media/") && source.url !== picture.url)).toBe(true)
    expect(listed[0]?.images[0]?.sources).toEqual(picture?.sources)
  })
})

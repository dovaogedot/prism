import { ImageId, type ProductImage } from "@prism/shared"
import { describe, expect, it } from "vitest"
import { PictureDrafts } from "../src/features/admin/picture-drafts.ts"

const picture = (id: string, alt: string): ProductImage => ({
  id: ImageId.schema.parse(id),
  url: `/media/${id}.webp`,
  alt,
  isPixelArt: false,
  sources: [],
})

const a = picture("0b6f1c2e-1d3a-4c5b-8e9f-0a1b2c3d4e5f", "A lamp")
const b = picture("1c7a2d3f-2e4b-4d6c-9f0a-1b2c3d4e5f60", "Its switch")
const c = picture("2d8b3e4a-3f5c-4e7d-8a1b-2c3d4e5f6071", "Its box")

describe("the unsaved order and texts of a product's pictures", () => {
  it("keep the order and the texts typed before an upload, with the new picture last", () => {
    const drafts = [
      { image: b, alt: "The switch, close up" },
      { image: a, alt: "A lamp" },
    ]

    expect(PictureDrafts.merge(drafts, [a, b], [a, b, c]).map((draft) => [draft.image.id, draft.alt])).toEqual([
      [b.id, "The switch, close up"],
      [a.id, "A lamp"],
      [c.id, "Its box"],
    ])
  })

  it("drop a deleted picture and keep the rest as they were edited", () => {
    const drafts = [
      { image: a, alt: "A brass lamp" },
      { image: b, alt: "Its switch" },
    ]

    expect(PictureDrafts.merge(drafts, [a, b], [a])).toEqual([{ image: a, alt: "A brass lamp" }])
  })

  it("take the server's text for a picture whose text nobody edited", () => {
    const saved = { ...a, alt: "A lamp, lit" }

    expect(PictureDrafts.merge(PictureDrafts.of([a]), [a], [saved])).toEqual([{ image: saved, alt: "A lamp, lit" }])
  })
})

import type { ProductImage } from "@prism/shared";
import { useState } from "react";
import { Dialog } from "../../../shared/ui/index.ts";
import { Picture } from "./Picture.tsx";

/** The product's pictures, and its name for the placeholder and the full-size view. */
export type GalleryProps = Readonly<{ images: readonly ProductImage[]; name: string }>;

/**
 * The product's pictures: the chosen one large, the others as buttons that
 * choose them, and a full-size view of the chosen one in a dialog. The large
 * picture loads first, in the size that fits the screen.
 */
export const Gallery = ({ images, name }: GalleryProps) => {
  const [chosen, setChosen] = useState(0);

  const [isEnlarged, setEnlarged] = useState(false);

  const image = images[chosen] ?? images[0];

  return (
    <div className="space-y-3">
      <div className="relative">
        <Picture
          className="aspect-square w-full rounded-lg border border-line"
          image={image}
          name={name}
          sizes="(min-width: 1152px) 34rem, (min-width: 1024px) 45vw, 100vw"
          isPriority
        />
        {image === undefined ? null : (
          <button
            className="absolute bottom-3 right-3 rounded-lg border border-line bg-surface/90 px-3 py-1.5 text-xs font-semibold text-ink backdrop-blur hover:border-line-strong"
            type="button"
            onClick={() => setEnlarged(true)}
          >
            View full size
          </button>
        )}
      </div>

      {images.length > 1 ? (
        <ul className="grid grid-cols-5 gap-2" aria-label="Pictures">
          {images.map((candidate, index) => (
            <li key={candidate.id}>
              <button
                className={`block w-full overflow-hidden rounded-lg border-2 ${index === chosen ? "border-accent" : "border-line hover:border-line-strong"}`}
                type="button"
                aria-label={`Show picture ${index + 1} of ${images.length}`}
                aria-pressed={index === chosen}
                onClick={() => setChosen(index)}
              >
                <Picture className="aspect-square w-full" image={candidate} name={name} sizes="6rem" isDecorative />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {image === undefined ? null : (
        <Dialog isOpen={isEnlarged} title={name} onClose={() => setEnlarged(false)} isWide>
          <img
            className={`mx-auto max-h-[75dvh] w-auto max-w-full ${image.isPixelArt ? "[image-rendering:pixelated]" : ""}`}
            src={image.url}
            alt={image.alt}
            width={image.width}
            height={image.height}
          />
        </Dialog>
      )}
    </div>
  );
};

/**
 * The page a product's stills are taken on.
 *
 * Opened by `scripts/render-stills.ts` in a headless browser, never by a
 * shopper, and left out of the storefront's build. It draws through the same
 * stages the storefront does, with the eye moved to where `viewpointOf` puts
 * the angle asked for, so a still and the live scene are one picture.
 */

import { Option, type StillSubject } from "@prism/shared";
import { match } from "ts-pattern";
import {
  openStage as openRoom,
  type Stage as RoomStage,
} from "../features/catalog/artwork/finisher-scene.ts";
import { whenMesh } from "../features/catalog/artwork/mesh.ts";
import { atRest, viewOf } from "../features/catalog/artwork/movement.ts";
import {
  openStage as openSlab,
  type Stage as SlabStage,
} from "../features/catalog/artwork/scene.ts";
import { REST } from "../features/catalog/artwork/tilt.ts";
import { viewpointOf, type Viewpoint } from "../features/catalog/artwork/viewpoint.ts";
import type { StillRequest } from "./bridge.ts";

/** How faithful a still's compression is, from 0 to 1, where 1 loses the least. */
const QUALITY = 0.9;

/** Settles once the mesh every room stands has arrived. */
const meshArrived = new Promise<void>((resolve) => {
  whenMesh(resolve);
});

/**
 * Draw one subject onto a canvas, from `viewpoint`.
 *
 * What was drawn stays on the canvas. Answers whether anything could be drawn.
 */
const drawOn = (
  canvas: HTMLCanvasElement,
  subject: StillSubject,
  viewpoint: Viewpoint,
): boolean =>
  match(subject)
    .with({ kind: "color" }, ({ hex, roughness, coatingNanometers, emission }) =>
      Option.match<SlabStage, boolean>({
        onSome: (stage) => {
          stage.draw({
            hex,
            finishing: { roughness, coatingNanometers, emission },
            tilt: REST,
            viewpoint,
          });
          stage.close();
          return true;
        },
        onNone: () => false,
      })(openSlab(canvas)),
    )
    .with({ kind: "finisher" }, (finisher) =>
      Option.match<RoomStage, boolean>({
        onSome: (stage) => {
          stage.draw({ ...viewOf(atRest(finisher)), viewpoint });
          stage.close();
          return true;
        },
        onNone: () => false,
      })(openRoom(canvas)),
    )
    .exhaustive();

const render = async ({ slug, subject, angle, theme, size }: StillRequest): Promise<string> => {
  await meshArrived;

  document.documentElement.classList.toggle("dark", theme === "dark");

  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  document.body.append(canvas);

  const drawn = drawOn(canvas, subject, viewpointOf(angle, slug));
  const still = canvas.toDataURL("image/webp", QUALITY);
  canvas.remove();

  return drawn ? still : Promise.reject(new Error("This browser cannot draw the scene."));
};

window.prismStills = { render };

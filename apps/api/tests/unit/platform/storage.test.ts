/**
 * Image type detection.
 *
 * A pure function over bytes, which is why the disguised-payload cases can be
 * exhaustive without a filesystem anywhere in sight.
 */

import { Option } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { detectImageType } from "../../../src/platform/storage.ts";

const png = (extra: readonly number[] = []) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...extra]);

const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const webp = () =>
  new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);

const ascii = (text: string) => new Uint8Array(Buffer.from(text, "ascii"));

describe("detectImageType", () => {
  it("identifies a PNG by its signature", () => {
    expect(detectImageType(png())).toEqual(Option.some("png"));
  });

  it("identifies a JPEG by its signature", () => {
    expect(detectImageType(jpeg())).toEqual(Option.some("jpg"));
  });

  it("identifies a WebP by RIFF plus the WEBP tag at offset 8", () => {
    expect(detectImageType(webp())).toEqual(Option.some("webp"));
  });

  it("rejects an empty file", () => {
    expect(detectImageType(new Uint8Array([]))).toEqual(Option.none);
  });

  it("rejects a truncated signature", () => {
    expect(detectImageType(new Uint8Array([0x89, 0x50]))).toEqual(Option.none);
  });

  it("rejects RIFF that is not WebP — a WAV file, for instance", () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);

    expect(detectImageType(wav)).toEqual(Option.none);
  });

  it("rejects RIFF too short to carry the tag", () => {
    expect(detectImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toEqual(
      Option.none,
    );
  });
});

describe("disguised uploads", () => {
  it("rejects a shell script whatever it is named", () => {
    expect(detectImageType(ascii("#!/bin/sh\nrm -rf /\n"))).toEqual(Option.none);
  });

  it("rejects a PHP web shell", () => {
    expect(detectImageType(ascii("<?php system($_GET['c']); ?>"))).toEqual(
      Option.none,
    );
  });

  it("rejects an ELF binary", () => {
    expect(
      detectImageType(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01])),
    ).toEqual(Option.none);
  });

  it("rejects HTML, which a browser would happily execute", () => {
    expect(detectImageType(ascii("<html><script>alert(1)</script>"))).toEqual(
      Option.none,
    );
  });

  it("rejects an SVG — it is an image, but a scriptable one", () => {
    expect(
      detectImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')),
    ).toEqual(Option.none);
  });

  it("rejects a zip, which is how polyglot files usually arrive", () => {
    expect(detectImageType(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toEqual(
      Option.none,
    );
  });

  it("accepts a PNG that happens to contain a script in its body", () => {
    // The magic bytes are the whole claim being made. Content after them is
    // pixel data, and the response is served with a fixed image content type
    // and nosniff, so an embedded string is inert.
    expect(detectImageType(png([...ascii("<script>alert(1)</script>")]))).toEqual(
      Option.some("png"),
    );
  });
});

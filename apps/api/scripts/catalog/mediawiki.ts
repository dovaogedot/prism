/**
 * The calls a MediaWiki API answers, read through zod: the text of pages,
 * the files of a wiki, the titles a list yields, and the infobox on a page.
 * Every call waits a beat, so no wiki is hammered.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { Sourced } from "./sourced.ts";

/** The parameters of one infobox, keyed by name. */
export type Infobox = Readonly<Record<string, string>>;

/** Where a file of a wiki is and how big it is, in pixels. */
export type WikiFile = Readonly<{ url: string; width: number; height: number }>;

const responses = {
  error: z.object({ error: z.object({ code: z.string(), info: z.string() }) }),
  pages: z.object({
    query: z.object({
      pages: z.array(
        z.object({
          title: z.string(),
          revisions: z.array(z.object({ slots: z.object({ main: z.object({ content: z.string() }) }) })).optional(),
        }),
      ),
    }),
  }),
  files: z.object({
    query: z.object({
      pages: z.array(z.object({ title: z.string(), imageinfo: z.array(z.object({ url: z.string(), width: z.number(), height: z.number() })).optional() })),
    }),
  }),
  list: z.object({
    continue: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.array(z.object({ title: z.string() }))),
  }),
};

export const MediaWiki = {
  /** How many titles one query may name. */
  BATCH: 50,

  /** One call to the API at `api`, read through `schema`. Throws on an error status, or an answer the schema refuses. */
  call: async <T>(api: string, schema: z.ZodType<T>, params: Readonly<Record<string, string>>): Promise<T> => {
    await sleep(200);
    const response = await fetch(api, {
      method: "POST",
      headers: { "user-agent": Sourced.USER_AGENT },
      body: new URLSearchParams({ ...params, format: "json", formatversion: "2" }),
    });
    if (!response.ok) throw new Error(`${api} answered ${response.status}`);

    const answer: unknown = await response.json();
    const refusal = responses.error.safeParse(answer);
    if (refusal.success) throw new Error(`${api} refused ${params["action"] ?? "the call"}: ${refusal.data.error.info}`);
    return schema.parse(answer);
  },

  /** `items` in runs of at most `size`. */
  chunks: <T>(items: readonly T[], size: number): readonly (readonly T[])[] =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size)),

  /** The wikitext of every page named in `titles`, keyed by the title the wiki lands on after its redirects. */
  pages: async (api: string, titles: readonly string[]): Promise<ReadonlyMap<string, string>> => {
    const found = new Map<string, string>();

    for (const batch of MediaWiki.chunks(titles, MediaWiki.BATCH)) {
      const result = await MediaWiki.call(api, responses.pages, { action: "query", prop: "revisions", rvprop: "content", rvslots: "main", redirects: "1", titles: batch.join("|") });
      for (const page of result.query.pages) {
        const content = page.revisions?.[0]?.slots.main.content;
        if (content !== undefined) found.set(page.title, content);
      }
    }

    return found;
  },

  /** The files among `titles`, given with their `File:` prefix, that the wiki has, keyed by the title as the wiki spells it. */
  files: async (api: string, titles: readonly string[]): Promise<ReadonlyMap<string, WikiFile>> => {
    const found = new Map<string, WikiFile>();

    for (const batch of MediaWiki.chunks(titles, MediaWiki.BATCH)) {
      const result = await MediaWiki.call(api, responses.files, { action: "query", prop: "imageinfo", iiprop: "url|size", titles: batch.join("|") });
      for (const page of result.query.pages) {
        const info = page.imageinfo?.[0];
        if (info !== undefined) found.set(page.title, info);
      }
    }

    return found;
  },

  /** Every title the list query `list` yields under `params`, following the wiki's continuation to the end. */
  list: async (api: string, list: string, params: Readonly<Record<string, string>>): Promise<readonly string[]> => {
    const titles: string[] = [];
    let next: Readonly<Record<string, string>> = {};

    for (;;) {
      const result = await MediaWiki.call(api, responses.list, { action: "query", list, ...params, ...next });
      titles.push(...(result.query[list] ?? []).map((page) => page.title));
      if (result.continue === undefined) return titles;
      next = result.continue;
    }
  },

  /**
   * The parameters of the `{{<template>` infobox in `wikitext`, or undefined
   * when the page carries none. A parameter starts a line with `|`.
   */
  infobox: (wikitext: string, template: string): Infobox | undefined => {
    const start = wikitext.indexOf(`{{${template}`);
    if (start < 0) return undefined;

    let depth = 0;
    let index = start;
    while (index < wikitext.length) {
      if (wikitext.startsWith("{{", index)) {
        depth += 1;
        index += 2;
      } else if (wikitext.startsWith("}}", index)) {
        depth -= 1;
        index += 2;
        if (depth === 0) break;
      } else index += 1;
    }

    const fields: Record<string, string> = {};
    for (const line of wikitext.slice(start + 2 + template.length, index - 2).split(/\n\s*\|/)) {
      const equals = line.indexOf("=");
      if (equals < 0) continue;
      fields[line.slice(0, equals).trim()] = line.slice(equals + 1).replace(/<!--[\s\S]*?-->/g, "").trim();
    }

    return fields;
  },
} as const;

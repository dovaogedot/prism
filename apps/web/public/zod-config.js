// zod's settings, applied before any of the app's modules load. zod compiles
// object parsers with `new Function` unless told not to, and decides whether
// it may as each schema is built, by trying it. The Content-Security-Policy
// bars eval, and the browser reports that try as a violation even though zod
// catches it, so zod is told not to try. zod keeps its settings on
// globalThis.__zod_globalConfig and adopts what it finds there when it loads,
// which a classic script reaches before any module runs.
globalThis.__zod_globalConfig = Object.assign(globalThis.__zod_globalConfig ?? {}, { jitless: true });

// Applied before first paint: without it the page flashes light before the
// React tree mounts and reads the stored preference. A file rather than an
// inline script, so the Content-Security-Policy can refuse every inline script.
(() => {
  let stored = null;
  try {
    stored = localStorage.getItem("prism-theme");
  } catch {
    // Storage can be blocked; the system preference decides then.
  }
  const dark = stored === "dark" || (stored === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();

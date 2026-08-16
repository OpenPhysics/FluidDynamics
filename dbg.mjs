import { chromium } from "@playwright/test";
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:5179/?initialScreen=2");
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const out = [];
  for (const p of document.querySelectorAll("p")) {
    const t = (p.textContent ?? "").trim();
    if (t.startsWith("Drag the knob toward") || t.startsWith("Drag a focus") || t.startsWith("Drag the knob up") || t.startsWith("Drag to move the obstacle")) {
      const prev = p.previousElementSibling;
      const parent = p.parentElement;
      out.push({
        help: t.slice(0, 30),
        hidden: p.closest("[hidden]") !== null,
        prevTag: prev?.tagName ?? null,
        prevFocusable: prev?.getAttribute("data-focusable") ?? null,
        prevLabel: prev?.getAttribute("aria-label") ?? null,
        prevText: (prev?.textContent ?? "").slice(0, 20) ?? null,
        parentTag: parent?.tagName,
        parentStyle: (parent?.getAttribute("style") ?? "").slice(0, 80),
      });
    }
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();

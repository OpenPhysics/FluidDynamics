import { chromium } from "@playwright/test";
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:5173/");
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Lab Screen" }).click({ force: true });
await page.waitForTimeout(1500);
for (const s of await page.locator("[role=slider]").all()) {
  console.log("slider:", await s.getAttribute("aria-label"), "| valuenow:", await s.getAttribute("aria-valuenow"));
}
// The obstacle's size/angle sliders are gone; the handles replace them.
const handles = await page.locator("[tabindex]").all();
for (const h of handles) {
  const label = await h.getAttribute("aria-label");
  if (label && (label.includes("Obstacle") || label.includes("focus") || label.includes("thickness"))) {
    console.log("handle:", label);
  }
}
await browser.close();

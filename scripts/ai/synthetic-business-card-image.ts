import { chromium } from "@playwright/test";

export interface SyntheticBusinessCardImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export async function createSyntheticBusinessCardImage(
  verificationMarker = "",
  layout: "standard" | "compact" = "standard",
  degradation: "none" | "gaussian" = "none",
): Promise<SyntheticBusinessCardImage> {
  const width = 1268;
  const height = 800;
  const safeMarker = verificationMarker
    .replace(/[^A-Za-z0-9-]/gu, "")
    .slice(0, 32);
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  });

  try {
    const page = await browser.newPage({
      viewport: { width: width + 80, height: height + 80 },
      deviceScaleFactor: 1,
    });
    await page.setContent(`
      <!doctype html>
      <html lang="ko">
        <head>
          <meta charset="utf-8" />
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; padding: 40px; background: #dfe6df; font-family: Arial, "Malgun Gothic", sans-serif; }
            #card { width: ${width}px; height: ${height}px; padding: 76px 84px; background: #fffdf7; color: #16221a; border: 2px solid #c9d4ca; }
            .brand { font-size: 38px; font-weight: 700; letter-spacing: 3px; color: #17613b; }
            h1 { margin: 90px 0 8px; font-size: 74px; line-height: 1; }
            .role { margin: 0 0 68px; font-size: 34px; color: #44544a; }
            .details { display: grid; gap: 17px; font-size: 29px; line-height: 1.25; }
            .label { display: inline-block; width: 48px; font-weight: 700; color: #17613b; }
          </style>
        </head>
        <body>
          <section id="card">
            ${
              layout === "compact"
                ? `<h1 style="margin: 0 0 12px; font-size: 80px">박준서</h1>
              <p class="role" style="margin-bottom: 82px">Business Development</p>
              <div class="brand" style="margin-bottom: 42px">ORBIT STUDIO</div>
              <div class="details">
                <div><span class="label">E</span>junseo.park@example.com</div>
                <div><span class="label">M</span>010-9876-5432</div>
              </div>`
                : `
            <div class="brand">PERSNAPSE LABS</div>
            <h1>김하늘</h1>
            <p class="role">Product Lead · Product Team</p>
            <div class="details">
              <div><span class="label">M</span>010-1234-5678</div>
              <div><span class="label">E</span>haneul.kim@example.com</div>
              <div><span class="label">W</span>www.persnapse.example</div>
              <div><span class="label">A</span>서울특별시 강남구 테헤란로 123</div>
              ${safeMarker ? `<div><span class="label">R</span>${safeMarker}</div>` : ""}
            </div>`
            }
          </section>
        </body>
      </html>
    `);
    const screenshot = await page.locator("#card").screenshot({ type: "png" });
    if (degradation === "none") {
      return { bytes: new Uint8Array(screenshot), width, height };
    }

    // tsx decorates nested functions with __name; expose the helper in this test page.
    await page.evaluate("globalThis.__name = (target) => target");
    const dataUrl = await page.evaluate(
      async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas unavailable for noisy fixture.");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        let seed = 20261008;
        const random = () => {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          return (seed >>> 0) / 4294967296;
        };
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
          const u = Math.max(random(), 1e-8);
          const v = random();
          const noise =
            Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 18;
          for (let channel = 0; channel < 3; channel += 1) {
            pixels.data[offset + channel] += noise;
          }
        }
        context.putImageData(pixels, 0, 0);
        return canvas.toDataURL("image/jpeg", 0.72);
      },
      `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`,
    );
    return {
      bytes: new Uint8Array(Buffer.from(dataUrl.split(",")[1], "base64")),
      width,
      height,
    };
  } finally {
    await browser.close();
  }
}

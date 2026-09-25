import { chromium } from "@playwright/test";

export interface SyntheticBusinessCardImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export async function createSyntheticBusinessCardImage(
  verificationMarker = "",
): Promise<SyntheticBusinessCardImage> {
  const width = 1268;
  const height = 800;
  const safeMarker = verificationMarker
    .replace(/[^A-Za-z0-9-]/gu, "")
    .slice(0, 32);
  const browser = await chromium.launch({ headless: true });

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
            <div class="brand">PERSNAPSE LABS</div>
            <h1>김하늘</h1>
            <p class="role">Product Lead · Product Team</p>
            <div class="details">
              <div><span class="label">M</span>010-1234-5678</div>
              <div><span class="label">E</span>haneul.kim@example.com</div>
              <div><span class="label">W</span>www.persnapse.example</div>
              <div><span class="label">A</span>서울특별시 강남구 테헤란로 123</div>
              ${safeMarker ? `<div><span class="label">R</span>${safeMarker}</div>` : ""}
            </div>
          </section>
        </body>
      </html>
    `);
    const bytes = await page.locator("#card").screenshot({ type: "png" });
    return { bytes: new Uint8Array(bytes), width, height };
  } finally {
    await browser.close();
  }
}

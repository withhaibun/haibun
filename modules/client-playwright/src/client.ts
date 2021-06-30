import playwright from "playwright";
declare var window: any;

(async () => {
  const browser = await playwright.webkit.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://www.example.com/");
  const dimensions = await page.evaluate(() => {
    return {
      deviceScaleFactor: window.devicePixelRatio,
    };
  });
  console.log(JSON.stringify(dimensions));

  await browser.close();
})();

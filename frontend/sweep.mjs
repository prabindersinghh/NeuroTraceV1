import { chromium } from "playwright-core";
const dir = "/private/tmp/claude-501/-Users-deepesh-Developer-NeuroTrace/276ffa24-18b6-4f45-9578-1910ba0a4e97/scratchpad";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let bucket = [];
const problems = {};
const add = (s) => { (problems[bucket] ??= []).push(s); };
page.on("pageerror", e => add(`PAGEERROR: ${e.message.split("\n")[0]}`));
page.on("console", m => {
  const t = m.text();
  if (m.type() === "error" && !/XNNPACK|favicon|Download the React DevTools/.test(t)) add(`CONSOLE: ${t.slice(0,180)}`);
});
page.on("response", r => { if (r.status() >= 400 && !/favicon/.test(r.url())) add(`HTTP ${r.status()} ${r.url().replace("http://localhost:8000","API").slice(0,80)}`); });

bucket = "login";
await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.fill('input[type="email"]', "clinician@neurotrace.app");
await page.fill('input[type="password"]', "neurotrace-demo");
await page.click('button[type="submit"]');
await page.waitForTimeout(3000);
console.log("after login →", await page.evaluate(() => location.pathname));
await page.screenshot({ path: `${dir}/sw-clinic.png` });

const pid = "afa2cf37-32fa-4624-93b5-4f8e90dd33af";
for (const r of ["/clinic", `/dashboard/${pid}`, `/report/${pid}`, `/review/${pid}`, `/enrol/${pid}`, `/onboarding/${pid}`, `/awaaz/${pid}`, "/diagnostics"]) {
  bucket = r;
  await page.goto(`http://localhost:5173${r}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2400);
  const info = await page.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g," ").trim().slice(0,80),
    blank: document.body.innerText.trim().length < 25,
  }));
  console.log(r.padEnd(46), info.blank ? "*** BLANK ***" : "|", info.text);
  await page.screenshot({ path: `${dir}/sw-${r.replace(/[\/:]/g,"_")}.png` });
}
console.log("\n=== PROBLEMS ===");
for (const [k, v] of Object.entries(problems)) {
  const uniq = [...new Set(v)];
  if (uniq.length) console.log(`\n[${k}]\n  ` + uniq.slice(0,6).join("\n  "));
}
await browser.close();

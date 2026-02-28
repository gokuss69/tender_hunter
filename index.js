/* =====================================================
   TENDER HUNTER — ROBUST WORKER VERSION
   Fixes:
   - Telegram 409 conflicts
   - Puppeteer crashes
   - Render restarts
   - Parallel execution bugs
===================================================== */

const TelegramBot = require("node-telegram-bot-api");
const puppeteer = require("puppeteer-core");
const https = require("https");

const sites = require("./sites");
const keywords = require("./keywords");
const negative = require("./negative");

/* ================= CONFIG ================= */

const TOKEN = process.env.TOKEN;
const MAX_RESULTS = 10;
const NAV_TIMEOUT = 60000;

if (!TOKEN) {
  console.error("TOKEN missing");
  process.exit(1);
}

/* ================= TELEGRAM ================= */

const bot = new TelegramBot(TOKEN, {
  polling: {
    autoStart: true,
    interval: 400,
    params: {
      timeout: 10
    }
  }
});

/* Prevent polling crash loops */
bot.on("polling_error", err => {
  console.log("Polling warning:", err.message);
});

console.log("Bot started");

/* ================= STATE LOCK ================= */

let scanRunning = false;

/* ================= COMMANDS ================= */

bot.onText(/\/start/, msg =>
  bot.sendMessage(msg.chat.id,
    "✅ Tender Hunter Active\nUse /check")
);

bot.onText(/\/ping/, msg =>
  bot.sendMessage(msg.chat.id, "🏓 Pong")
);

/* ================= MAIN CHECK ================= */

bot.onText(/\/check/, async msg => {

  const chatId = msg.chat.id;

  if (scanRunning) {
    return bot.sendMessage(chatId,
      "⏳ Scan already running...");
  }

  scanRunning = true;

  await bot.sendMessage(chatId,
    "🔎 Checking territory tenders...");

  for (const site of sites) {

    try {

      const allowed = await checkRobots(site.url);
      if (!allowed) continue;

      const results = await retryScrape(site, 2);
      const filtered = filterResults(results);

      if (!filtered.length) {
        await bot.sendMessage(chatId,
          `No matches — ${site.name}`);
        continue;
      }

      for (const item of filtered.slice(0, MAX_RESULTS)) {
        await bot.sendMessage(chatId,
          formatTender(site, item));
      }

    } catch (err) {
      console.log("SITE FAILED:", site.name, err.message);
      await bot.sendMessage(chatId,
        `❌ ${site.name} failed`);
    }
  }

  scanRunning = false;
  bot.sendMessage(chatId, "✅ Scan complete");
});

/* ================= RETRY WRAPPER ================= */

async function retryScrape(site, retries) {

  for (let i = 0; i <= retries; i++) {
    try {
      return await scrapeSite(site);
    } catch (err) {
      if (i === retries) throw err;
      await sleep(3000);
    }
  }
}

/* ================= ROBOTS ================= */

function checkRobots(url) {

  return new Promise(resolve => {

    try {
      const robotsUrl = new URL("/robots.txt", url);

      https.get(robotsUrl, res => {
        if (res.statusCode !== 200) return resolve(true);

        let data = "";
        res.on("data", d => data += d);

        res.on("end", () => {
          resolve(!data.toLowerCase()
            .includes("disallow: /"));
        });

      }).on("error", () => resolve(true));

    } catch {
      resolve(true);
    }
  });
}

/* ================= SCRAPER ================= */

async function scrapeSite(site) {

  let browser;

  try {

    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote"
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    );

    await page.goto(site.url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT
    });

    await page.waitForTimeout(4000);

    const data = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a"))
        .map(a => a.innerText.trim())
        .filter(t => t.length > 30)
    );

    return data;

  } finally {
    if (browser) await browser.close();
  }
}

/* ================= FILTER ================= */

function filterResults(results) {

  return results.filter(text => {

    const lower = text.toLowerCase();

    const positive = keywords.some(k =>
      lower.includes(k));

    const negativeHit = negative.some(n =>
      lower.includes(n));

    return positive && !negativeHit;
  });
}

/* ================= FORMAT ================= */

function formatTender(site, text) {

  let score = keywords.reduce(
    (s,k)=> text.toLowerCase().includes(k)?s+1:s,0);

  const confidence =
    score>5?"HIGH":score>2?"MEDIUM":"LOW";

  const stars =
    confidence==="HIGH"?"★★★★★":
    confidence==="MEDIUM"?"★★★":"★★";

  return `
━━━━━━━━━━━━━━━━━━━━
🔬 TENDER ALERT — ${confidence}
━━━━━━━━━━━━━━━━━━━━
🏛 ${site.name}
📄 ${text}
⭐ Priority: ${stars}
━━━━━━━━━━━━━━━━━━━━`;
}

/* ================= UTILS ================= */

function sleep(ms){
  return new Promise(r=>setTimeout(r,ms));
}

/* ================= SAFE SHUTDOWN ================= */

process.on("SIGINT", () => {
  console.log("Shutdown");
  process.exit();
});

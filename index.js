/* =====================================================
   TENDER HUNTER — RENDER FREE SAFE FINAL VERSION
===================================================== */

require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const puppeteer = require("puppeteer-core");
const https = require("https");

const sites = require("./sites");
const keywords = require("./keywords");
const negative = require("./negative");

/* ================= EXPRESS HEALTH SERVER ================= */

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Tender Hunter running ✅");
});

app.listen(PORT, () => {
  console.log("Health server running on port", PORT);
});

/* ================= TELEGRAM BOT ================= */

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error("TOKEN missing in .env");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, {
  polling: {
    autoStart: true,
    interval: 400,
    params: { timeout: 10 }
  }
});

bot.on("polling_error", err =>
  console.log("Polling warning:", err.message)
);

console.log("Bot started");

/* ================= GLOBAL STATE ================= */

let browser = null;
let scanRunning = false;

/* ================= SHARED BROWSER ================= */

async function getBrowser() {

  if (browser) return browser;

  console.log("Launching shared browser...");

  browser = await puppeteer.launch({
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote"
    ]
  });

  return browser;
}

/* ================= BOT COMMANDS ================= */

bot.onText(/\/start/, msg =>
  bot.sendMessage(msg.chat.id,
    "✅ Tender Hunter Ready\nUse /check")
);

bot.onText(/\/ping/, msg =>
  bot.sendMessage(msg.chat.id, "🏓 Pong")
);

/* ================= MAIN SCAN ================= */

bot.onText(/\/check/, async msg => {

  const chatId = msg.chat.id;

  if (scanRunning)
    return bot.sendMessage(chatId,
      "⏳ Scan already running");

  scanRunning = true;

  await bot.sendMessage(chatId,
    "🔎 Checking territory tenders...");

  for (const site of sites) {

    try {

      const allowed = await checkRobots(site.url);
      if (!allowed) continue;

      const results = await scrapeSite(site);
      const filtered = filterResults(results);

      if (!filtered.length) {
        await bot.sendMessage(chatId,
          `No matches — ${site.name}`);
        continue;
      }

      for (const item of filtered.slice(0,10)) {
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

/* ================= ROBOTS CHECK ================= */

function checkRobots(url) {
  return new Promise(resolve => {
    try {
      const robotsUrl = new URL("/robots.txt", url);

      https.get(robotsUrl, res => {

        if (res.statusCode !== 200)
          return resolve(true);

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

/* ================= NIC DETECTOR ================= */

function isNICPortal(url) {
  return url.includes("nicgep") ||
         url.includes("eprocure.gov.in");
}

/* ================= SCRAPER ================= */

async function scrapeSite(site) {

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    );

    await page.goto(site.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    /* ---------- NIC PORTALS ---------- */

    if (isNICPortal(site.url)) {

      console.log("NIC portal detected:", site.name);

      await page.waitForSelector("table", { timeout: 20000 });
      await page.waitForTimeout(5000);

      const tenders = await page.evaluate(() => {

        const rows =
          Array.from(document.querySelectorAll("table tbody tr"));

        return rows.map(row => {

          const cols = row.querySelectorAll("td");
          if (cols.length < 3) return null;

          const org = cols[0]?.innerText?.trim();
          const title = cols[1]?.innerText?.trim();
          const date = cols[2]?.innerText?.trim();

          return `${title} | ${org} | Closing: ${date}`;
        }).filter(Boolean);
      });

      return tenders;
    }

    /* ---------- NORMAL SITES ---------- */

    await page.waitForTimeout(4000);

    const data = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a"))
        .map(a => a.innerText.trim())
        .filter(t => t.length > 30)
    );

    return data;

  } finally {
    await page.close();
  }
}

/* ================= FILTER ================= */

function filterResults(results) {

  return results.filter(text => {

    const lower = text.toLowerCase();

    const positive =
      keywords.some(k => lower.includes(k));

    const negativeHit =
      negative.some(n => lower.includes(n));

    return positive && !negativeHit;
  });
}

/* ================= OUTPUT FORMAT ================= */

function formatTender(site, text) {

  let score =
    keywords.reduce((s,k)=>
      text.toLowerCase().includes(k)?s+1:s,0);

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

/* ================= GRACEFUL SHUTDOWN ================= */

async function closeBrowser() {
  if (browser) {
    console.log("Closing browser...");
    await browser.close();
  }
}

process.on("SIGINT", closeBrowser);
process.on("SIGTERM", closeBrowser);

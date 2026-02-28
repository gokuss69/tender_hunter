/* =====================================================
   TENDER HUNTER — RENDER FREE SAFE VERSION
===================================================== */

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const puppeteer = require("puppeteer-core");
const https = require("https");

const sites = require("./sites");
const keywords = require("./keywords");
const negative = require("./negative");

/* ================= WEB SERVER (RENDER FIX) ================= */

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Tender Hunter running ✅");
});

app.listen(PORT, () => {
  console.log("Health server running on port", PORT);
});

/* ================= TELEGRAM ================= */

const TOKEN = process.env.TOKEN;

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

/* ================= STATE LOCK ================= */

let scanRunning = false;

/* ================= COMMANDS ================= */

bot.onText(/\/start/, msg =>
  bot.sendMessage(msg.chat.id,
    "✅ Tender Hunter Ready\nUse /check")
);

bot.onText(/\/ping/, msg =>
  bot.sendMessage(msg.chat.id, "🏓 Pong")
);

/* ================= MAIN CHECK ================= */

bot.onText(/\/check/, async msg => {

  if (scanRunning)
    return bot.sendMessage(msg.chat.id,
      "⏳ Scan already running");

  scanRunning = true;

  const chatId = msg.chat.id;

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
      console.log(site.name, err.message);
      await bot.sendMessage(chatId,
        `❌ ${site.name} failed`);
    }
  }

  scanRunning = false;
  bot.sendMessage(chatId, "✅ Scan complete");
});

/* ================= ROBOTS ================= */

function checkRobots(url) {
  return new Promise(resolve => {
    try {
      const robotsUrl = new URL("/robots.txt", url);

      https.get(robotsUrl, res => {
        if (res.statusCode !== 200) return resolve(true);

        let data="";
        res.on("data", d => data+=d);
        res.on("end", () =>
          resolve(!data.toLowerCase()
            .includes("disallow: /")));
      }).on("error", ()=>resolve(true));

    } catch {
      resolve(true);
    }
  });
}

/* ================= SCRAPER ================= */

async function scrapeSite(site) {

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--single-process"
    ]
  });

  try {

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    );

    await page.goto(site.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(4000);

    const data = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a"))
        .map(a=>a.innerText.trim())
        .filter(t=>t.length>30)
    );

    return data;

  } finally {
    await browser.close();
  }
}

/* ================= FILTER ================= */

function filterResults(results) {

  return results.filter(text => {

    const lower = text.toLowerCase();

    const pos = keywords.some(k =>
      lower.includes(k));

    const neg = negative.some(n =>
      lower.includes(n));

    return pos && !neg;
  });
}

/* ================= FORMAT ================= */

function formatTender(site, text) {

  let score = keywords.reduce(
    (s,k)=>text.toLowerCase().includes(k)?s+1:s,0);

  const stars =
    score>5?"★★★★★":
    score>2?"★★★":"★★";

  return `
━━━━━━━━━━━━━━━━━━━━
🔬 TENDER ALERT
━━━━━━━━━━━━━━━━━━━━
🏛 ${site.name}
📄 ${text}
⭐ Priority: ${stars}
━━━━━━━━━━━━━━━━━━━━`;
}

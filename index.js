/* =====================================================
   TENDER HUNTER — TERRITORY INTELLIGENCE BOT
   Render + Puppeteer-Core Stable Version
===================================================== */

const TelegramBot = require("node-telegram-bot-api");
const puppeteer = require("puppeteer-core");
const https = require("https");

const sites = require("./sites");
const keywords = require("./keywords");
const negative = require("./negative");

/* ================= TOKEN ================= */

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error("TOKEN missing");
  process.exit(1);
}

/* ================= TELEGRAM ================= */

const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10 }
  }
});

bot.on("polling_error", err => {
  console.log("Polling error:", err.message);
});

console.log("Bot started");

/* ================= COMMANDS ================= */

bot.onText(/\/start/, msg => {
  bot.sendMessage(
    msg.chat.id,
    "✅ Tender Hunter Ready\nUse /check"
  );
});

bot.onText(/\/ping/, msg => {
  bot.sendMessage(msg.chat.id, "🏓 Pong");
});

/* ================= MAIN CHECK ================= */

bot.onText(/\/check/, async msg => {

  const chatId = msg.chat.id;

  await bot.sendMessage(chatId, "🔎 Checking territory tenders...");

  for (const site of sites) {

    try {

      const allowed = await checkRobots(site.url);
      if (!allowed) {
        console.log("Blocked by robots:", site.name);
        continue;
      }

      const results = await scrapeSite(site);
      const filtered = filterResults(results);

      if (!filtered.length) {
        await bot.sendMessage(chatId, `No matches — ${site.name}`);
        continue;
      }

      for (const item of filtered.slice(0,10)) {
        await bot.sendMessage(chatId, formatTender(site, item));
      }

    } catch (err) {
      console.log("SCRAPE ERROR:", site.name, err.message);
      await bot.sendMessage(chatId, `❌ ${site.name} failed`);
    }
  }

  bot.sendMessage(chatId, "✅ Scan complete");
});

/* ================= ROBOTS.TXT ================= */

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
          if (data.toLowerCase().includes("disallow: /"))
            resolve(false);
          else resolve(true);
        });

      }).on("error", () => resolve(true));

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
      "--disable-gpu",
      "--single-process",
      "--no-zygote"
    ]
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  );

  await page.setViewport({
    width: 1366,
    height: 768
  });

  try {

    await page.goto(site.url, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    await page.waitForTimeout(5000);

    const data = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a"))
        .map(a => a.innerText.trim())
        .filter(t => t.length > 30)
    );

    await browser.close();

    return data;

  } catch (err) {

    await browser.close();
    throw err;
  }
}

/* ================= FILTER ================= */

function filterResults(results) {

  return results.filter(text => {

    const lower = text.toLowerCase();

    const positive = keywords.some(k =>
      lower.includes(k.toLowerCase())
    );

    const negativeHit = negative.some(n =>
      lower.includes(n.toLowerCase())
    );

    return positive && !negativeHit;
  });
}

/* ================= FORMAT OUTPUT ================= */

function formatTender(site, text) {

  const lower = text.toLowerCase();

  let category = "General Analytical";

  if (lower.includes("spectro") || lower.includes("ftir"))
    category = "Spectroscopy";

  else if (lower.includes("icp") || lower.includes("xrf"))
    category = "Elemental Analysis";

  else if (lower.includes("titr"))
    category = "Wet Chemistry";

  else if (lower.includes("dissolution"))
    category = "Pharma Testing";

  else if (lower.includes("microwave"))
    category = "Sample Preparation";

  /* confidence scoring */

  let score = 0;

  keywords.forEach(k => {
    if (lower.includes(k)) score++;
  });

  let confidence = "LOW";
  let stars = "★★";

  if (score > 5) {
    confidence = "HIGH";
    stars = "★★★★★";
  }
  else if (score > 2) {
    confidence = "MEDIUM";
    stars = "★★★";
  }

  /* territory mapping */

  let location = "Territory";

  const name = site.name.toLowerCase();

  if (name.includes("chandigarh"))
    location = "Chandigarh Tricity";
  else if (name.includes("punjab"))
    location = "Punjab";
  else if (name.includes("jammu"))
    location = "J&K";
  else if (name.includes("himachal"))
    location = "Himachal Pradesh";

  return `
━━━━━━━━━━━━━━━━━━━━
🔬 TENDER ALERT — ${confidence}
━━━━━━━━━━━━━━━━━━━━

🏛 Institute:
${site.name}

📍 Location:
${location}

🧪 Category:
${category}

📄 Tender Title:
${text}

⭐ Sales Priority:
${stars}

━━━━━━━━━━━━━━━━━━━━
`;
}

const TelegramBot = require("node-telegram-bot-api");
const puppeteer = require("puppeteer-core");
const https = require("https");

const sites = require("./sites");
const keywords = require("./keywords");
const negative = require("./negative");

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error("TOKEN missing");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, {
  polling: { params: { timeout: 10 } }
});

console.log("Bot started");

/* ================= START ================= */

bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id,
    "✅ Tender Hunter Ready\nUse /check");
});

bot.onText(/\/ping/, msg => {
  bot.sendMessage(msg.chat.id, "🏓 Pong");
});

/* ================= CHECK ================= */

bot.onText(/\/check/, async msg => {

  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🔎 Checking territory tenders...");

  for (const site of sites) {

    try {

      const allowed = await checkRobots(site.url);
      if (!allowed) continue;

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
      console.log(err.message);
      bot.sendMessage(chatId, `❌ Error checking ${site.name}`);
    }
  }

  bot.sendMessage(chatId, "✅ Scan complete");
});

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
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  const page = await browser.newPage();

  await page.goto(site.url, {
    waitUntil: "networkidle2",
    timeout: 60000
  });

  await page.waitForTimeout(3000);

  const data = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a"))
      .map(a => a.innerText.trim())
      .filter(t => t.length > 25)
  );

  await browser.close();
  return data;
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

  /* confidence score */

  let score = 0;
  keywords.forEach(k => {
    if (lower.includes(k)) score++;
  });

  let confidence = "LOW";
  let stars = "★★";

  if (score > 5) {
    confidence = "HIGH";
    stars = "★★★★★";
  } else if (score > 2) {
    confidence = "MEDIUM";
    stars = "★★★";
  }

  let location = "Territory";

  if (site.name.toLowerCase().includes("chandigarh"))
    location = "Chandigarh Tricity";
  else if (site.name.toLowerCase().includes("punjab"))
    location = "Punjab";
  else if (site.name.toLowerCase().includes("jammu"))
    location = "J&K";
  else if (site.name.toLowerCase().includes("himachal"))
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

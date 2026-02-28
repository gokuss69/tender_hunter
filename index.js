const TelegramBot = require("node-telegram-bot-api");
const puppeteer = require("puppeteer-core");
const https = require("https");

const sites = require("./sites");
const keywords = require("./keywords");
const negative = require("./negative");

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error("TOKEN missing!");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

console.log("Bot started...");

/* ===============================
   BASIC COMMANDS
================================ */

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "✅ Tender Hunter Bot Ready\nUse /check to scan sites."
  );
});

bot.onText(/\/ping/, (msg) => {
  bot.sendMessage(msg.chat.id, "🏓 Pong");
});

/* ===============================
   MAIN CHECK COMMAND
================================ */

bot.onText(/\/check/, async (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, "🔎 Checking sites...");

  for (const site of sites) {
    try {
      const allowed = await checkRobots(site.url);

      if (!allowed) {
        bot.sendMessage(chatId, `🚫 Blocked by robots.txt: ${site.name}`);
        continue;
      }

      const results = await scrapeSite(site);
      const filtered = filterResults(results);

      if (filtered.length === 0) {
        bot.sendMessage(chatId, `No matches from ${site.name}`);
        continue;
      }

      for (const item of filtered.slice(0, 10)) {
        await bot.sendMessage(
          chatId,
          `📌 ${site.name}\n${item}`
        );
      }
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, `❌ Error checking ${site.name}`);
    }
  }

  bot.sendMessage(chatId, "✅ Scan complete.");
});

/* ===============================
   ROBOTS.TXT CHECK
================================ */

function checkRobots(url) {
  return new Promise((resolve) => {
    try {
      const robotsUrl = new URL("/robots.txt", url);

      https
        .get(robotsUrl, (res) => {
          if (res.statusCode !== 200) {
            resolve(true);
            return;
          }

          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (data.toLowerCase().includes("disallow: /")) {
              resolve(false);
            } else {
              resolve(true);
            }
          });
        })
        .on("error", () => resolve(true));
    } catch {
      resolve(true);
    }
  });
}

/* ===============================
   SCRAPER
================================ */

async function scrapeSite(site) {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  await page.goto(site.url, {
    waitUntil: "networkidle2",
    timeout: 60000
  });

  await page.waitForTimeout(3000);

  const data = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a"))
      .map((a) => a.innerText.trim())
      .filter((t) => t.length > 25);
  });

  await browser.close();

  return data;
}

/* ===============================
   FILTER LOGIC
================================ */

function filterResults(results) {
  return results.filter((text) => {
    const lower = text.toLowerCase();

    const hasPositive = keywords.some((k) =>
      lower.includes(k.toLowerCase())
    );

    const hasNegative = negative.some((n) =>
      lower.includes(n.toLowerCase())
    );

    return hasPositive && !hasNegative;
  });
}

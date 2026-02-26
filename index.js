const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');

const sites = require('./sites');
const keywords = require('./keywords');
const negative = require('./negative');

const token = process.env.TOKEN;
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Tender Bot Ready 🚀");
});

bot.onText(/\/check/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Checking sites...");

  for (const site of sites) {
    try {
      const results = await scrapeSite(site);
      const filtered = filterResults(results);

      for (const item of filtered) {
        bot.sendMessage(chatId, item);
      }

    } catch (err) {
      bot.sendMessage(chatId, `Error checking ${site.name}`);
    }
  }
});

async function scrapeSite(site) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto(site.url, { waitUntil: 'networkidle2' });

  const data = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a'))
      .map(a => a.innerText)
      .filter(text => text.length > 20);
  });

  await browser.close();
  return data;
}

function filterResults(results) {
  return results.filter(text => {
    const lower = text.toLowerCase();

    const hasPositive = keywords.some(k => lower.includes(k));
    const hasNegative = negative.some(n => lower.includes(n));

    return hasPositive && !hasNegative;
  });
}

console.log("Bot started...");

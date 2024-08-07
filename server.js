const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const sqlite3 = require("sqlite3").verbose();
const puppeteer = require("puppeteer");
const cron = require("node-cron");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
// const wss = new WebSocket.Server({ server });

// Initialize SQLite Database
const db = new sqlite3.Database(
  "./data.db",
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (err) => {
    if (err) console.error(err.message);
    console.log("Connected to the SQLite database.");
    db.run(`CREATE TABLE IF NOT EXISTS data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        poolid INTEGER,
        apr REAL,
        target TEXT,
        UNIQUE(name, target)
    )`);
  }
);

async function fetchAuraApr(name, poolId) {
  console.log(`fetching aura ${name}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    dumpio: true,
  });
  const page = await browser.newPage();
  page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
  page.on("error", (err) => console.error("PAGE ERROR:", err));
  page.on("pageerror", (pageErr) => console.error("PAGE PAGEERROR:", pageErr));
  page.on("requestfailed", (request) =>
    console.error(
      "PAGE REQUESTFAILED:",
      request.url(),
      request.failure().errorText
    )
  );

  page.setDefaultNavigationTimeout(120000);
  await page.goto(`https://app.aura.finance/#/1/pool/${poolId}`, {
    // waitUntil: "networkidle0",
  });

  await page.waitForSelector(".MuiTypography-root", { timeout: 180000 });

  const evaluate = async () => {
    const apr = await page.evaluate(() => {
      const vAPRTextElement = [...document.querySelectorAll("p")].find((p) =>
        p.textContent?.includes("Current vAPR")
      );
      if (vAPRTextElement && vAPRTextElement.nextElementSibling) {
        const aprElement =
          vAPRTextElement.nextElementSibling.querySelector("p");
        const aprElementText = aprElement?.textContent;
        const number = parseFloat(aprElementText?.replace("%", "") ?? "0");
        return !isNaN(number) ? number : 0;
      }
      return 0;
    });
    return apr;
  };

  let apr = await evaluate();
  if (apr === 0) {
    // Retry after 10 seconds if APR is 0
    await new Promise((resolve) => setTimeout(resolve, 10000));
    apr = await evaluate();
  }

  updatePoolData(name, poolId, apr, "Aura");

  await browser.close();
}

async function fetchConvexApr(name, poolId) {
  console.log(`fetching convex ${name}`);
  const browser = await puppeteer.launch({
    headless: true,
    // executablePath: "/usr/bin/chromium-browser",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
    dumpio: true,
  });
  console.log(`page loaded convex ${name}`);

  const page = await browser.newPage();
  page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
  page.on("error", (err) => console.error("PAGE ERROR:", err));
  page.on("pageerror", (pageErr) => console.error("PAGE PAGEERROR:", pageErr));
  page.on("requestfailed", (request) =>
    console.error(
      "PAGE REQUESTFAILED:",
      request.url(),
      request.failure().errorText
    )
  );

  page.setDefaultNavigationTimeout(120000);
  // await page.setJavaScriptEnabled(false);
  await page.goto(`https://curve.convexfinance.com/stake/ethereum/${poolId}`, {
    // waitUntil: "networkidle0",
  });
  console.log(`page goto convex ${name}`);

  // Using XPath to find the element containing the APR percentage
  await page.waitForSelector(".MuiAccordionSummary-content", {
    timeout: 180000,
  });

  const evaluate = async () => {
    const apr = await page.evaluate(() => {
      const allSpans = Array.from(document.querySelectorAll("span"));
      const projSpan = allSpans.find((span) =>
        span.textContent?.includes("proj.")
      );
      if (projSpan) {
        const textContent = projSpan.textContent ?? "";
        const number = parseFloat(textContent.split("%")[0]);
        return !isNaN(number) ? number : 0;
      }
      return 0;
    });
    return apr;
  };

  let apr = await evaluate();
  if (apr === 0) {
    // Retry after 10 seconds if APR is 0
    await new Promise((resolve) => setTimeout(resolve, 10000));
    apr = await evaluate();
  }

  updatePoolData(name, poolId, apr, "Convex");

  await browser.close();
}

// Function to update the database and notify clients
const updatePoolData = async (name, poolid, apr, target) => {
  const entry = [name.toLowerCase(), poolid, apr, target];
  db.run(
    `INSERT INTO data (name, poolid, apr, target) VALUES (?, ?, ?, ?)
    ON CONFLICT(name, target) DO UPDATE SET poolid=excluded.poolid, apr=excluded.apr, target=excluded.target;`,
    entry,
    (err) => {
      if (err) return console.error(err.message);

      console.log("data", entry);
      // Notify all connected WebSocket clients
      // wss.clients.forEach((client) => {
      //   if (client.readyState === WebSocket.OPEN) {
      //     client.send(JSON.stringify(entry));
      //   }
      // });
    }
  );
};

const updateData = async () => {
  await fetchAuraApr("pxETH/wETH", 185);
  await fetchAuraApr("rETH/wETH", 109);
  await fetchAuraApr("USDT/GHO/USDC", 157);
  await fetchAuraApr("TBTC/WBTC", 159);
  await fetchAuraApr("sUSDe/USDC", 208);
  // fetchAuraApr("alcx/wETH", 74);

  await fetchConvexApr("ALCX/FRAXBP", 120);
  // fetchConvexApr("OHM/FRAXBP", 138); // weird
  await fetchConvexApr("stETH/ETH", 25);
  await fetchConvexApr("pyUSD/USDC", 270);
  await fetchConvexApr("PXETH/WETH", 271);
  await fetchConvexApr("CRVUSD/USDC", 182);
  await fetchConvexApr("CRVUSD/USDT", 179);
};

// Schedule data updates every 10 minutes using cron syntax
cron.schedule("*/60 * * * *", updateData);

app.use(cors());

app.get("/apr", (req, res) => {
  // Query the database for all records in the 'data' table
  db.all("SELECT * FROM data", [], (err, rows) => {
    if (err) {
      console.error(err.message);
      res.status(500).send("An error occurred while retrieving data.");
      return;
    }
    // Send the fetched data as a JSON response
    res.json(rows);
  });
});

server.listen(3030, () => {
  updateData();
  console.log("Server started on http://localhost:3030");
});

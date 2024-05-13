const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const sqlite3 = require("sqlite3").verbose();
const puppeteer = require("puppeteer");
const cron = require("node-cron");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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
  const browser = await puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-features=site-per-process",
    ],
  });
  const page = await browser.newPage();
  await page.goto(`https://app.aura.finance/#/1/pool/${poolId}`, {
    waitUntil: "networkidle0",
  });

  // Using XPath to find the element containing the APR percentage

  const apr = await page.evaluate(() => {
    // Find the <p> with text 'Current vAPR'
    const vAPRTextElement = [...document.querySelectorAll("p")].find(
      (p) => !!p.textContent && p.textContent.includes("Current vAPR")
    );

    // Navigate to the next sibling <div> and find the <p> inside it
    if (vAPRTextElement && vAPRTextElement.nextElementSibling) {
      const aprElement = vAPRTextElement.nextElementSibling.querySelector("p");
      const aprElementText = aprElement ? aprElement.textContent : null;
      const aprValue = aprElementText
        ? Number(aprElementText.replace("%", ""))
        : 0;
      return aprValue;
    }
    return 0;
  });

  updatePoolData(name, poolId, apr, "Aura");

  await browser.close();
}

async function fetchConvexApr(name, poolId) {
  const browser = await puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-features=site-per-process",
    ],
  });
  const page = await browser.newPage();
  await page.goto(`https://curve.convexfinance.com/stake/ethereum/${poolId}`, {
    waitUntil: "networkidle0",
  });

  // Using XPath to find the element containing the APR percentage

  const apr = await page.evaluate(() => {
    const allSpans = Array.from(document.querySelectorAll("span"));
    // Find the span that contains "proj."
    const projSpan = allSpans.find((span) =>
      span.textContent ? span.textContent.includes("proj.") : false
    );
    if (projSpan) {
      const textContent = projSpan.textContent ?? "";
      const number = textContent.split("%")[0]; // Regex to extract digits followed by a '%'
      return !Number.isNaN(number) ? Number(number) : 0;
    }
    return 0;
  });
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
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(entry));
        }
      });
    }
  );
};

const updateData = async () => {
  fetchAuraApr("pxETH/wETH", 185);
  fetchAuraApr("rETH/wETH", 109);
  fetchAuraApr("alcx/wETH", 74);

  fetchConvexApr("ALCX/FRAXBP", 120);
  fetchConvexApr("OHM/FRAXBP", 138); // weird
  fetchConvexApr("stETH/ETH", 25);
  fetchConvexApr("pyUSD/USDC", 270);
  fetchConvexApr("PXETH/WETH", 271);
  fetchConvexApr("CRVUSD/USDC", 182);
  fetchConvexApr("CRVUSD/USDT", 179);
};

// Schedule data updates every 10 minutes using cron syntax
cron.schedule("*/10 * * * *", updateData);

// app.use(
//   cors({
//     origin: "http://localhost:3001", // Specify the origin of the frontend
//   })
// );

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

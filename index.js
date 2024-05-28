const puppeteer = require("puppeteer");

async function fetchAuraApr(poolId) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(`https://app.aura.finance/#/1/pool/${poolId}`, {
    waitUntil: "networkidle0",
  }); // Replace with the URL of your website

  // Using XPath to find the element containing the APR percentage

  const aprValue = await page.evaluate(() => {
    // Find the <p> with text 'Current vAPR'
    const vAPRTextElement = [...document.querySelectorAll("p")].find(
      (p) => !!p.textContent && p.textContent.includes("Current vAPR")
    );

    // Navigate to the next sibling <div> and find the <p> inside it
    if (vAPRTextElement && vAPRTextElement.nextElementSibling) {
      const aprElement = vAPRTextElement.nextElementSibling.querySelector("p");
      const aprElementText = aprElement ? aprElement.textContent : null;
      const apr = aprElementText
        ? Number(aprElementText.replace("%", "")) / 100
        : 0;
      return apr;
    }
    return null;
  });

  console.log(aprValue); // This should log '21.04%'

  await browser.close();
}

async function fetchConvexApr(poolId) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(`https://curve.convexfinance.com/stake/ethereum/${poolId}`, {
    waitUntil: "networkidle0",
  }); // Replace with the URL of your website

  // Using XPath to find the element containing the APR percentage

  const percentageValue = await page.evaluate(() => {
    console.log("entered ");
    const allSpans = Array.from(document.querySelectorAll("span"));
    // Find the span that contains "proj."
    const projSpan = allSpans.find((span) =>
      span.textContent ? span.textContent.includes("proj.") : false
    );
    if (projSpan) {
      const textContent = projSpan.textContent ?? "";
      const number = textContent.split("%")[0]; // Regex to extract digits followed by a '%'
      return !Number.isNaN(number) ? Number(number) / 100 : 0;
    }
    return null;
  });

  console.log(`Pool: ${poolId} - ${percentageValue * 100}%`); // This should log '21.04%'

  await browser.close();
}

// fetchAuraApr(185); // pxETH/wETH  -  0.2087
// fetchAuraApr(109); // rETH/wETH   -  0.0419
// fetchAuraApr(74); //  alcx/wETH   -  0.06

// fetchConvexApr(120); //ALCX_FRAXBP - 34.65
// // fetchConvexApr(138); //OHM_FRAXBP - weird
// fetchConvexApr(25); //steth+eth - 1.6
// fetchConvexApr(270); //pyusd+usdc -
// fetchConvexApr(271); //PXETH_WETH - 28.14
fetchConvexApr(182); //CRVUSD_USDC - 9.26
fetchConvexApr(179); //CRVUSD_USDT - 9.26

#!/usr/bin/env node
/**
 * Test runner for presently
 * Starts a local server and runs Playwright tests with coverage
 *
 * Usage: npm test
 *
 * For webcams: localhost is treated as secure context, so HTTP is fine.
 * No HTTPS needed for getUserMedia on localhost.
 */

import express from "express";
import { chromium } from "playwright";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3456;
const HOST = "localhost";

async function main() {
  const app = express();
  app.use(express.static(__dirname));

  const server = createServer(app);

  // Start server
  await new Promise((resolve) => server.listen(PORT, HOST, resolve));
  console.log(`Server running at http://${HOST}:${PORT}`);

  let browser;
  try {
    // Launch Playwright
    browser = await chromium.launch({
      headless: true,
    });

    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
    });

    // Start JS coverage
    await page.coverage.startJSCoverage({ reportAnonymousScripts: true });

    // Pipe console output
    page.on("console", (msg) => console.log(msg.text()));
    page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

    // Navigate to test page
    const testUrl = `http://${HOST}:${PORT}/index.html?test=1`;
    console.log(`\nRunning tests at ${testUrl}\n`);

    await page.goto(testUrl);

    // Wait for tests to complete
    await page.waitForFunction(() => window.TESTS_DONE, { timeout: 60000 });

    // Stop coverage and report
    const coverage = await page.coverage.stopJSCoverage();

    // Find coverage for our main files
    const files = ["index.html", "main.js", "view.html", "view.js"];
    const components = ["app.js", "deck.js", "presentation.js", "slide.js", "editor.js", "preview.js", "view.js", "video-sources.js"];

    for (const entry of coverage) {
      const url = entry.url;
      const isRelevant = files.some((f) => url.includes(f)) || url.includes("/components/");

      if (isRelevant && entry.source) {
        const lines = entry.source.split("\n");
        const totalLines = lines.length;
        const lineOffsets = [0];
        for (let i = 0; i < totalLines; i++) {
          lineOffsets.push(lineOffsets[i] + lines[i].length + 1);
        }

        const uncoveredLines = new Set();
        for (const func of entry.functions) {
          for (const range of func.ranges) {
            if (!range.count) {
              for (let i = 0; i < totalLines; i++) {
                if (range.startOffset < lineOffsets[i + 1] && range.endOffset > lineOffsets[i]) {
                  uncoveredLines.add(i + 1);
                }
              }
            }
          }
        }

        const coveredLines = totalLines - uncoveredLines.size;
        const percent = ((coveredLines / totalLines) * 100).toFixed(1);

        // Extract filename from URL
        const filename = url.split("/").pop().split("?")[0];
        console.log(`Coverage: ${filename} - ${coveredLines}/${totalLines} lines (${percent}%)`);

        // Report uncovered functions
        const uncoveredFuncs = entry.functions.filter(
          (f) => f.functionName && f.ranges.every((r) => !r.count)
        );
        if (uncoveredFuncs.length > 0 && uncoveredFuncs.length < 20) {
          console.log(`  Uncovered functions:`);
          for (const f of uncoveredFuncs) {
            console.log(`    ${f.functionName}`);
          }
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
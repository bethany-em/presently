import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.PRESENTLY_TEST_URL ?? "https://localhost/v2/index.html?test=1";
const solidRuntimeFiles = [
  "dist/solid.js",
  "html/dist/html.js",
  "store/dist/store.js",
  "web/dist/web.js",
  "LICENSE"
];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let server;
let serverError;
let serverLog = "";
let browser;

const canReachApp = () => new Promise(resolve => {
  const request = https.get(url, { rejectUnauthorized: false }, response => {
    response.resume();
    resolve(response.statusCode === 200);
  });
  request.setTimeout(500, () => request.destroy());
  request.on("error", () => resolve(false));
});

async function waitForApp() {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await canReachApp()) return;
    if (serverError) throw serverError;
    if (server?.exitCode !== null) throw new Error(`Caddy exited during startup (${server.exitCode}).`);
    await delay(100);
  }
  throw new Error("Caddy did not make v2 available over HTTPS.");
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise(resolve => server.once("exit", resolve));
  const stop = spawn("caddy", ["stop", "--config", "Caddyfile"], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true
  });
  await Promise.race([
    new Promise(resolve => {
      stop.once("error", resolve);
      stop.once("exit", resolve);
    }),
    delay(2000)
  ]);
  await Promise.race([exited, delay(1000)]);
  if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
}

const settle = page => page.evaluate(() => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))
));

async function verifyVendoredSolid() {
  for (const file of solidRuntimeFiles) {
    const installed = await readFile(path.join(root, "node_modules", "solid-js", file));
    const vendored = await readFile(path.join(root, "vendor", "solid-js", file));
    if (!installed.equals(vendored)) throw new Error(`Vendored Solid file is stale: ${file}`);
  }
  console.log("Vendored Solid: exact solid-js 1.9.14 source");
}

async function verifyColumns(page, count) {
  await page.evaluate(value => window.presently.commands.slideColumns(value), count);
  await settle(page);
  return page.evaluate(expected => {
    const grid = document.querySelector(".slide-grid");
    const style = getComputedStyle(grid);
    const columns = style.gridTemplateColumns.split(" ").filter(Boolean).map(parseFloat);
    const gaps = parseFloat(style.columnGap) * (columns.length - 1);
    return columns.length === expected
      && Math.abs(columns.reduce((sum, width) => sum + width, 0) + gaps - grid.clientWidth) < 2;
  }, count);
}

async function verifyAspect(page, screenId, width, height) {
  await page.evaluate(({ id, width, height }) => {
    window.presently.commands.screenWidth(id, width);
    window.presently.commands.screenHeight(id, height);
  }, { id: screenId, width, height });
  await settle(page);
  return page.evaluate(({ id, ratio }) => {
    const preview = document.querySelector(`[data-screen-id="${id}"] .canvas`).getBoundingClientRect();
    const thumbnail = document.querySelector(".slide-card .canvas").getBoundingClientRect();
    return [preview, thumbnail].every(box => Math.abs(box.width / box.height - ratio) < .01);
  }, { id: screenId, ratio: width / height });
}

function reportCoverage(entries) {
  const relevant = entries.filter(entry => entry.url && /\/(app|controller|model|canvas|media|outputs|history)\.js$/.test(new URL(entry.url).pathname));
  if (!relevant.length) throw new Error("Playwright did not return first-party module coverage.");
  let coveredTotal = 0;
  let lineTotal = 0;
  for (const entry of relevant) {
    const lines = entry.source.split("\n");
    const offsets = [0];
    for (const line of lines) offsets.push(offsets.at(-1) + line.length + 1);
    const uncovered = new Set();
    for (const fn of entry.functions) {
      for (const range of fn.ranges) {
        if (range.count) continue;
        for (let line = 0; line < lines.length; line++)
          if (range.startOffset < offsets[line + 1] && range.endOffset > offsets[line]) uncovered.add(line);
      }
    }
    const covered = lines.length - uncovered.size;
    coveredTotal += covered;
    lineTotal += lines.length;
    console.log(`${new URL(entry.url).pathname.slice(1)}: ${covered}/${lines.length} lines (${(100 * covered / lines.length).toFixed(1)}%)`);
    const uncoveredFunctions = entry.functions.filter(fn => fn.functionName && fn.ranges.every(range => !range.count));
    if (uncoveredFunctions.length) console.log(`Uncovered: ${uncoveredFunctions.map(fn => fn.functionName).join(", ")}`);
  }
  console.log(`First-party coverage: ${coveredTotal}/${lineTotal} lines (${(100 * coveredTotal / lineTotal).toFixed(1)}%)`);
}

try {
  await verifyVendoredSolid();
  if (!await canReachApp()) {
    server = spawn("caddy", ["run", "--config", "Caddyfile"], { cwd: root, windowsHide: true });
    server.once("error", error => serverError = error);
    server.stdout.on("data", chunk => serverLog += chunk);
    server.stderr.on("data", chunk => serverLog += chunk);
  }
  await waitForApp();

  browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  const runtimeRequests = [];
  page.on("request", request => runtimeRequests.push(new URL(request.url()).pathname));
  page.on("console", message => console.log(message.text()));
  page.on("pageerror", error => {
    pageErrors.push(error.message);
    console.error("PAGE ERROR:", error.stack || error.message);
  });
  await page.coverage.startJSCoverage({ reportAnonymousScripts: true });
  await page.goto(url);
  await page.waitForFunction(() => window.TESTS_DONE, null, { timeout: 30000 });

  const builtInFailures = await page.evaluate(() => window.TESTS_FAILED);
  const runtimeGraph = {
    noNodeModules: runtimeRequests.every(pathname => !pathname.includes("/node_modules/")),
    vendoredSolid: solidRuntimeFiles
      .filter(file => file.endsWith(".js"))
      .every(file => runtimeRequests.some(pathname => pathname.endsWith(`/vendor/solid-js/${file}`)))
  };
  console.log(`Runtime graph: ${Object.values(runtimeGraph).every(Boolean) ? "vendored Solid, no node_modules" : "not deployable"}`);
  const defaultColumns = await page.evaluate(() => {
    const grid = document.querySelector(".slide-grid");
    return window.presently.queries.workspace().slideColumns === 3
      && getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length === 3;
  });
  console.log(`Default deck: ${defaultColumns ? "3 columns" : "failed"}`);
  const screenId = await page.evaluate(() => window.presently.queries.workspace().screens[0].id);
  const expectedCopy = await page.evaluate(id => {
    const { commands, queries } = window.presently;
    const deck = queries.deck();
    commands.screenWidth(id, 1920);
    commands.screenHeight(id, 1080);
    commands.previewScreen(id);
    commands.slideColumns(2);
    commands.select(deck.presentations[0].id, deck.presentations[0].slides[0].id);
    return deck.presentations[0].slides[0].content;
  }, screenId);

  const columnResults = {
    two: await verifyColumns(page, 2),
    ten: await verifyColumns(page, 10)
  };
  await page.evaluate(() => window.presently.commands.slideColumns(2));
  console.log(`Deck columns: ${Object.values(columnResults).every(Boolean) ? "2–10 fill width" : "failed"}`);

  const workspaceLayout = await page.evaluate(async () => {
    const deck = document.querySelector(".deck-panel");
    const sources = document.querySelector(".sources");
    const outputs = document.querySelector(".outputs");
    const toolbar = document.querySelector(".toolbar");
    const toolbarBox = toolbar.getBoundingClientRect();
    const screenHeads = [...document.querySelectorAll(".screen-head")];
    const sourceTop = sources.getBoundingClientRect().top;
    deck.scrollTop = deck.scrollHeight;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const deckBox = deck.getBoundingClientRect();
    const activeSetHead = document.elementFromPoint(deckBox.left + 12, deckBox.top + 12)?.closest(".presentation-head");
    const activeSetBox = activeSetHead?.getBoundingClientRect();
    const addedScreens = Array.from({ length: 4 }, () => window.presently.commands.addScreen());
    await new Promise(resolve => requestAnimationFrame(resolve));
    outputs.scrollTop = outputs.scrollHeight;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const outputsBox = outputs.getBoundingClientRect();
    const activeScreenBox = [...document.querySelectorAll(".screen-head")]
      .map(head => head.getBoundingClientRect())
      .find(box => box.top <= outputsBox.top + 1 && box.bottom > outputsBox.top + 1);
    addedScreens.forEach(id => window.presently.commands.removeScreen(id));
    return {
      deckScrolls: deck.scrollHeight > deck.clientHeight && deck.scrollTop > 0,
      sourcesStayPut: Math.abs(sources.getBoundingClientRect().top - sourceTop) < 1,
      screensStayVisible: outputs.getBoundingClientRect().height === innerHeight,
      threeToOneShell: outputs.getBoundingClientRect().width / innerWidth >= .22
        && outputs.getBoundingClientRect().width / innerWidth <= .28,
      singleContextBar: toolbarBox.height >= 44 && toolbarBox.height <= 52
        && !document.querySelector(".toolbar-primary, .toolbar-secondary"),
      setTakesStickyContext: Boolean(activeSetHead && Math.abs(activeSetBox.top - deckBox.top) < 1),
      screenTakesStickyContext: Boolean(activeScreenBox),
      nativeEditSwitch: document.querySelector('[data-test="edit-mode"][role="switch"]')?.type === "checkbox",
      settingsStartClosed: [...document.querySelectorAll(".screen-menu")]
        .every(details => !details.open),
      oneRowScreens: screenHeads.every(head => head.getBoundingClientRect().height <= 36),
      noRedundantReadouts: !document.querySelector(".cue-readout, .deck-view-controls, .screen-state"),
      moveAffordances: document.querySelectorAll(".move-mark").length > 1
        && getComputedStyle(document.querySelector(".drag-handle")).cursor === "move",
      historyFits: ["undo", "redo"].every(name => document.querySelector(`[data-test="${name}"]`))
        && document.querySelector(".toolbar-actions").scrollWidth <= document.querySelector(".toolbar-actions").clientWidth,
      noMainMenu: !document.querySelector(".toolbar details"),
      alignedControls: [...document.querySelectorAll(
        ".toolbar-actions > .quiet-action, .toolbar-actions > .edit-switch, .presentation-actions .quiet-action, .presentation-actions > .edit-switch"
      )].every(control => {
        const box = control.getBoundingClientRect();
        const header = control.closest(".toolbar, .presentation-head").getBoundingClientRect();
        return Math.abs(box.height - 28) < 1 && Math.abs((box.top + box.bottom - header.top - header.bottom) / 2) < 1;
      }),
      setEditSwitches: document.querySelectorAll(".presentation-head .edit-switch").length
        === window.presently.queries.deck().presentations.length,
      editModeFlush: [...document.querySelectorAll(".toolbar .edit-switch, .presentation-head .edit-switch")]
        .every(control => control.closest(".toolbar, .presentation-head").getBoundingClientRect().right
          - control.getBoundingClientRect().right <= 12),
      inlineSelects: [...document.querySelectorAll("select")].every(select => {
        const style = getComputedStyle(select);
        return select.getBoundingClientRect().height === 28 && style.backgroundColor === "rgba(0, 0, 0, 0)";
      }),
      footerControls: (() => {
        const footer = document.querySelector(".deck-footer").getBoundingClientRect();
        const controls = document.querySelector(".deck-size-controls").getBoundingClientRect();
        const labels = [...document.querySelectorAll(".deck-size-controls label > span:first-child")]
          .map(label => label.textContent);
        return Math.abs(footer.right - controls.right) <= 12 && controls.bottom <= footer.bottom + 1
          && labels.join() === "Screen size,Slide size";
      })(),
      previewControl: document.querySelector('[aria-label="Thumbnail screen size"]')?.value === window.presently.queries.workspace().previewScreenId
    };
  });
  console.log(`Live workspace: ${Object.values(workspaceLayout).every(Boolean) ? "fixed deck/source/screens" : "failed"}`);

  const collapsedLiveCue = await page.evaluate(async () => {
    const { commands, queries } = window.presently;
    const set = queries.deck().presentations[0];
    commands.setSetCollapsed(set.id, false);
    commands.select(set.id, set.slides[0].id);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    commands.setSetCollapsed(set.id, true);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const presentation = document.querySelector(".presentation");
    const cue = presentation.querySelector(".set-live-cue");
    const result = !presentation.querySelector(".slide-grid")
      && cue && !cue.hidden && cue.textContent.includes("LIVE · 01")
      && queries.selection()?.slideId === set.slides[0].id;
    commands.setSetCollapsed(set.id, false);
    return Boolean(result);
  });
  console.log(`Collapsed live set: ${collapsedLiveCue ? "visible cue preserved" : "failed"}`);

  const compactControls = await page.evaluate(() => {
    const selectors = [
      ".collapse-toggle",
      ".slide-tools .drag-handle",
      ".slide-tools .danger",
      ".set-move",
      ".set-remove",
      ".screen-menu > summary"
    ];
    return selectors.every(selector => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box && box.width >= 23.9 && box.height >= 23.9;
    });
  });
  console.log(`Compact controls: ${compactControls ? "24px minimum targets" : "undersized"}`);

  const attributionLayout = await page.evaluate(async () => {
    const presentation = [...document.querySelectorAll(".presentation")].at(-1);
    presentation.scrollIntoView({ block: "start" });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const grid = presentation.querySelector(".slide-grid");
    const attribution = presentation.querySelector(".set-attribution");
    const gridBox = grid.getBoundingClientRect();
    const attributionBox = attribution.getBoundingClientRect();
    return !presentation.querySelector(".set-menu")
      && attributionBox.top >= gridBox.bottom
      && Math.abs(attributionBox.left - gridBox.left) < 1
      && Math.abs(attributionBox.right - gridBox.right) < 1;
  });
  console.log(`Set attribution: ${attributionLayout ? "inline below slides" : "misplaced"}`);

  const aspectResults = {
    widescreen: await verifyAspect(page, screenId, 1920, 1080),
    classic: await verifyAspect(page, screenId, 1024, 768),
    ultrawide: await verifyAspect(page, screenId, 2560, 1080),
    portrait: await verifyAspect(page, screenId, 1080, 1920)
  };
  console.log(`Controller aspects: ${Object.values(aspectResults).every(Boolean) ? "16:9, 4:3, 64:27, 9:16" : "distorted"}`);

  await page.evaluate(id => {
    window.presently.commands.screenWidth(id, 1920);
    window.presently.commands.screenHeight(id, 1080);
  }, screenId);
  const popupPromise = page.waitForEvent("popup");
  await page.locator(`[data-screen-id="${screenId}"] [data-test="open-output"]`).click();
  const viewer = await popupPromise;
  viewer.on("pageerror", error => pageErrors.push(error.message));
  await viewer.waitForSelector(".canvas");
  await viewer.waitForFunction(expected => document.querySelector(".canvas-text")?.innerText === expected, expectedCopy);
  await viewer.setViewportSize({ width: 1000, height: 800 });
  let viewerBox = await viewer.locator(".canvas").boundingBox();
  const viewerWidescreen = Math.abs(viewerBox.width / viewerBox.height - 16 / 9) < .01;
  await page.evaluate(id => {
    window.presently.commands.screenWidth(id, 1024);
    window.presently.commands.screenHeight(id, 768);
  }, screenId);
  await viewer.waitForFunction(() => {
    const box = document.querySelector(".canvas").getBoundingClientRect();
    return Math.abs(box.width / box.height - 4 / 3) < .01;
  });
  viewerBox = await viewer.locator(".canvas").boundingBox();
  const viewerClassic = Math.abs(viewerBox.width / viewerBox.height - 4 / 3) < .01;
  console.log(`Standalone output: ${viewerWidescreen && viewerClassic ? "letterboxes arbitrary ratios" : "distorted"}`);
  await viewer.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await page.waitForFunction(id => {
    const card = document.querySelector(`[data-screen-id="${id}"]`);
    return !card?.querySelector(".output-open")?.classList.contains("open");
  }, screenId);
  await viewer.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await page.waitForFunction(id => {
    const card = document.querySelector(`[data-screen-id="${id}"]`);
    return card?.querySelector(".output-open")?.classList.contains("open");
  }, screenId);
  const viewerReconnect = true;
  console.log("Viewer lifecycle: pagehide/pageshow disconnect/reconnect");
  await viewer.close();

  const dprContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 2
  });
  const dprPage = await dprContext.newPage();
  await dprPage.goto(new URL("index.html", url).href);
  await dprPage.waitForSelector(".slide-card .canvas");
  const dprResult = await dprPage.evaluate(() => {
    const box = document.querySelector(".slide-card .canvas").getBoundingClientRect();
    return devicePixelRatio === 2 && Math.abs(box.width / box.height - 16 / 9) < .01;
  });
  console.log(`2× scaling: ${dprResult ? "CSS geometry preserved" : "failed"}`);
  await dprContext.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.presently.commands.slideColumns(3));
  await settle(page);
  const narrowFits = await page.evaluate(async () => {
    const toolbar = document.querySelector(".toolbar").getBoundingClientRect();
    const toolbarActions = document.querySelector(".toolbar-actions");
    const setActions = document.querySelector(".presentation-actions");
    const screenMenu = document.querySelector(".screen-menu");
    screenMenu.open = true;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const fitsOpenDisclosure = document.documentElement.scrollWidth <= innerWidth + 1;
    const screenPanel = screenMenu.querySelector(".screen-settings-panel");
    const screenPanelBox = screenPanel.getBoundingClientRect();
    const screenPanelFits = getComputedStyle(screenPanel).position === "absolute"
      && screenPanelBox.left >= -1 && screenPanelBox.right <= innerWidth + 1;
    screenMenu.open = false;
    return fitsOpenDisclosure
      && document.documentElement.scrollWidth <= innerWidth + 1
      && toolbar.height >= 44 && toolbar.height <= 52
      && toolbarActions.scrollWidth <= toolbarActions.clientWidth
      && setActions.scrollWidth <= setActions.clientWidth
      && screenPanelFits
      && getComputedStyle(document.querySelector(".slide-grid")).gridTemplateColumns.split(" ").filter(Boolean).length === 3;
  });
  console.log(`Narrow viewport: ${narrowFits ? "fits" : "horizontal overflow"}`);

  reportCoverage(await page.coverage.stopJSCoverage());
  const checks = [
    !builtInFailures,
    !pageErrors.length,
    Object.values(runtimeGraph).every(Boolean),
    defaultColumns,
    Object.values(columnResults).every(Boolean),
    Object.values(workspaceLayout).every(Boolean),
    collapsedLiveCue,
    compactControls,
    attributionLayout,
    Object.values(aspectResults).every(Boolean),
    viewerWidescreen,
    viewerClassic,
    viewerReconnect,
    dprResult,
    narrowFits
  ];
  if (!checks.every(Boolean)) {
    throw new Error(`${builtInFailures} built-in failures, ${pageErrors.length} page errors; runtime=${JSON.stringify(runtimeGraph)} defaultColumns=${defaultColumns} columns=${JSON.stringify(columnResults)} workspace=${JSON.stringify(workspaceLayout)} collapsedLive=${collapsedLiveCue} targets=${compactControls} attribution=${attributionLayout} aspects=${JSON.stringify(aspectResults)} viewer=${viewerWidescreen}/${viewerClassic}/${viewerReconnect} dpr=${dprResult} narrow=${narrowFits}`);
  }
} catch (error) {
  if (serverLog) console.error(serverLog.trim());
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stopServer();
}

import { h, render } from "preact";
import htm from "htm";
import App from "./components/app.js";

const html = htm.bind(h);
render(html`<${App} />`, window.app);

// =============================================================================
// TESTS: Activated with ?test=1 query parameter
// =============================================================================

if (new URLSearchParams(window.location.search).get("test") === "1") {
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg || "Assertion failed");
  };

  async function runTests(tests) {
    let passed = 0,
      failed = 0;
    for (const test of tests) {
      try {
        await test();
        console.log(`PASS: ${test.name}`);
        passed++;
      } catch (e) {
        console.error(`FAIL: ${test.name}\n   ${e.message}`);
        failed++;
      }
    }
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    return { passed, failed };
  }

  // Import services for testing
  const { hashStringToIndex, getColor, defaultPalette } = await import(
    "./services/colors.js"
  );

  // =============================================================================
  // UNIT TESTS: Color Service
  // =============================================================================

  async function testHashStringToIndex() {
    // Same string should always produce same index
    const idx1 = hashStringToIndex("hello", 100);
    const idx2 = hashStringToIndex("hello", 100);
    assert(idx1 === idx2, "Same string should produce same index");

    // Index should be within bounds
    assert(idx1 >= 0 && idx1 < 100, "Index should be within array bounds");

    // Different strings should (likely) produce different indices
    const idx3 = hashStringToIndex("world", 100);
    // Not asserting inequality since hash collisions can happen

    // Empty string should work
    const emptyIdx = hashStringToIndex("", 100);
    assert(emptyIdx >= 0 && emptyIdx < 100, "Empty string should produce valid index");
  }

  async function testGetColor() {
    // Same string should always produce same color
    const color1 = getColor("Slide Title");
    const color2 = getColor("Slide Title");
    assert(color1 === color2, "Same string should produce same color");

    // Color should be a valid hex color
    assert(/^#[0-9a-f]{6}$/i.test(color1), "Color should be valid hex");

    // Should use default palette
    assert(defaultPalette.includes(color1), "Color should be from default palette");
  }

  async function testDefaultPalette() {
    assert(Array.isArray(defaultPalette), "Palette should be an array");
    assert(defaultPalette.length > 0, "Palette should not be empty");
    assert(
      defaultPalette.every((c) => /^#[0-9a-f]{6}$/i.test(c)),
      "All palette colors should be valid hex"
    );
  }

  // =============================================================================
  // UI TESTS: Render Checks
  // =============================================================================

  async function testUIRenders() {
    // Wait for app to render
    await new Promise((r) => setTimeout(r, 100));

    const app = document.getElementById("app");
    assert(app, "App container exists");

    // Check for deck structure
    assert(app.querySelector(".deck") || app.querySelector('[class*="deck"]'), "Deck renders");

    // Check for preview panel
    const preview = app.querySelector("iframe");
    assert(preview, "Preview iframe renders");

    // Check for video sources section (may be empty but should exist)
    const videoSection = app.querySelector('[class*="video"]') || app.querySelector("video");
    // Video section is optional, not asserting
  }

  async function testDeckStructure() {
    await new Promise((r) => setTimeout(r, 100));

    // Check localStorage has deck data
    const storedDeck = localStorage.getItem("deck");
    assert(storedDeck, "Deck should be stored in localStorage");

    const deck = JSON.parse(storedDeck);
    assert(deck.id, "Deck should have id");
    assert(Array.isArray(deck.presentations), "Deck should have presentations array");
    assert(deck.presentations.length > 0, "Deck should have at least one presentation");

    const firstPresentation = deck.presentations[0];
    assert(firstPresentation.id, "Presentation should have id");
    assert(Array.isArray(firstPresentation.slides), "Presentation should have slides array");
  }

  // =============================================================================
  // RUN ALL TESTS
  // =============================================================================

  const tests = [
    testHashStringToIndex,
    testGetColor,
    testDefaultPalette,
    testUIRenders,
    testDeckStructure,
  ];

  runTests(tests).then(({ failed }) => {
    window.TESTS_DONE = true;
    if (failed > 0) console.error(`\n${failed} test(s) failed!`);
  });
}

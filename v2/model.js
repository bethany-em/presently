export const DEFAULT_SCREEN_SIZE = Object.freeze({ width: 1920, height: 1080 });
export const TEXT_LAYOUT = Object.freeze({
  safeX: 0.06,
  safeTop: 0.07,
  safeBottom: 0.13,
  lineHeight: 1.18,
  safety: 0.98
});

export const POSITIONS = Object.freeze([
  "top-left", "top-center", "top-right",
  "center-left", "center-center", "center-right",
  "bottom-left", "bottom-center", "bottom-right"
]);

export const POSITION_LAYOUT = Object.freeze({
  "top-left": ["flex-start", "flex-start", "left"],
  "top-center": ["center", "flex-start", "center"],
  "top-right": ["flex-end", "flex-start", "right"],
  "center-left": ["flex-start", "center", "left"],
  "center-center": ["center", "center", "center"],
  "center-right": ["flex-end", "center", "right"],
  "bottom-left": ["flex-start", "flex-end", "left"],
  "bottom-center": ["center", "flex-end", "center"],
  "bottom-right": ["flex-end", "flex-end", "right"]
});

const VIDEO_MODES = new Set(["off", "cover", "contain"]);
const POSITION_SET = new Set(POSITIONS);
const TAG_COLORS = ["#8b3f4d", "#8a572f", "#6f6730", "#416a4b", "#32666c", "#3e5f87", "#625184", "#7a466f"];
const HEADING = /^(intro|verse|chorus|bridge|pre[ -]?chorus|instrumental|interlude|outro|ending|vamp|tag)\b[^\r\n]*$/gim;

export const cleanText = value => String(value ?? "").trimEnd();
export const clamp = (value, min, max, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

const uniqueIdFactory = makeId => {
  const used = new Set();
  return value => {
    const candidate = String(value ?? "").trim();
    if (candidate && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    let id;
    do id = makeId(); while (used.has(id));
    used.add(id);
    return id;
  };
};

export const createSlide = (makeId, title = "", content = "") => ({
  id: makeId(),
  title,
  content
});

export const createPresentation = (makeId, title = "New set", slides = [createSlide(makeId)], attribution = "") => ({
  id: makeId(),
  title,
  attribution,
  slides
});

export const createScreen = (makeId, label = "Output", dimensions = DEFAULT_SCREEN_SIZE) => ({
  id: makeId(),
  label,
  videoMode: "off",
  textPositions: {
    withoutVideo: "center-center",
    withVideo: "bottom-center"
  },
  textRows: 8,
  width: clamp(dimensions.width, 1, Number.MAX_SAFE_INTEGER, DEFAULT_SCREEN_SIZE.width),
  height: clamp(dimensions.height, 1, Number.MAX_SAFE_INTEGER, DEFAULT_SCREEN_SIZE.height)
});

export const sampleDeck = makeId => ({
  version: 2,
  id: makeId(),
  title: "Presently Demo",
  presentations: [
    createPresentation(makeId, "Presently Tutorial", [
      createSlide(makeId, "Welcome", "Presently puts words and video\nOn any screen in the room"),
      createSlide(makeId, "Cue words", "Click a slide to show it\nClick it again to clear it"),
      createSlide(makeId, "Edit words", "Double-click a slide to edit its words\nDouble-click again to take it live"),
      createSlide(makeId, "Navigate", "← → moves through slides\n↑ ↓ moves through sets\nEsc clears words"),
      createSlide(makeId, "Paste", "Paste Verse and Chorus text\nChoose whether to split it"),
      createSlide(makeId, "Labels", "Edit titles, labels, and attribution anytime\nColor makes structure easy to scan"),
      createSlide(makeId, "Reorder", "Drag a slide or set by its handle\nThe live cue follows its identity"),
      createSlide(makeId, "Sources", "Choose a camera or share a display\nRefresh to rebuild the source strip"),
      createSlide(makeId, "Screens", "Every named screen remembers\nVideo, position, rows, and resolution"),
      createSlide(makeId, "Standby", "Clear the words whenever you need\nVideo can keep playing underneath")
    ])
  ]
});

export function defaultWorkspace(makeId) {
  const stage = createScreen(makeId, "Stage");
  const audience = {
    ...createScreen(makeId, "Audience"),
    videoMode: "cover"
  };
  return {
    slideColumns: 2,
    previewScreenId: stage.id,
    collapsedSetIds: [],
    screens: [stage, audience]
  };
}

export function normalizeDeck(input, makeId) {
  const source = input && typeof input === "object" ? input : {};
  const uniqueId = uniqueIdFactory(makeId);
  const presentations = Array.isArray(source.presentations) ? source.presentations : [];
  return {
    version: 2,
    id: uniqueId(source.id),
    title: cleanText(source.title) || "Untitled deck",
    presentations: presentations.map(presentation => ({
      id: uniqueId(presentation?.id),
      title: cleanText(presentation?.title) || "Untitled set",
      attribution: cleanText(presentation?.attribution),
      slides: (Array.isArray(presentation?.slides) ? presentation.slides : []).map(slide => ({
        id: uniqueId(slide?.id),
        title: cleanText(slide?.title),
        content: cleanText(slide?.content)
      }))
    }))
  };
}

export function normalizeWorkspace(input, makeId) {
  const source = input && typeof input === "object" ? input : {};
  const collapsedSetIds = [...new Set(
    (Array.isArray(source.collapsedSetIds) ? source.collapsedSetIds : [])
      .filter(id => typeof id === "string")
      .map(id => id.trim())
      .filter(Boolean)
  )];
  if (!Array.isArray(source.screens)) {
    return { ...defaultWorkspace(makeId), collapsedSetIds };
  }
  const uniqueId = uniqueIdFactory(makeId);
  const screens = source.screens.map((screen, index) => {
    const positions = screen?.textPositions ?? {};
    const legacyMode = screen?.video
      ? (source.fitVideo ? "contain" : "cover")
      : "off";
    return {
      id: uniqueId(screen?.id),
      label: cleanText(screen?.label) || "Screen " + (index + 1),
      videoMode: VIDEO_MODES.has(screen?.videoMode) ? screen.videoMode : legacyMode,
      textPositions: {
        withoutVideo: POSITION_SET.has(positions.withoutVideo) ? positions.withoutVideo : "center-center",
        withVideo: POSITION_SET.has(positions.withVideo) ? positions.withVideo : "bottom-center"
      },
      textRows: clamp(screen?.textRows, 1, 20, 8),
      width: clamp(screen?.width, 1, Number.MAX_SAFE_INTEGER, DEFAULT_SCREEN_SIZE.width),
      height: clamp(screen?.height, 1, Number.MAX_SAFE_INTEGER, DEFAULT_SCREEN_SIZE.height)
    };
  });
  const previewScreenId = screens.some(screen => screen.id === source.previewScreenId)
    ? source.previewScreenId
    : screens[0]?.id ?? null;
  return {
    slideColumns: clamp(source.slideColumns, 2, 10, 2),
    previewScreenId,
    collapsedSetIds,
    screens
  };
}

export function reconcileCollapsedSetIds(deck, ids) {
  const existing = new Set(deck.presentations.map(presentation => presentation.id));
  return [...new Set(Array.isArray(ids) ? ids : [])].filter(id => existing.has(id));
}

export const flattenSlides = deck => deck.presentations.flatMap((presentation, presentationIndex) =>
  presentation.slides.map((slide, slideIndex) => ({
    presentation,
    presentationIndex,
    slide,
    slideIndex
  }))
);

export const selectedEntry = (deck, selected) =>
  selected?.slideId
    ? flattenSlides(deck).find(entry => entry.slide.id === selected.slideId) ?? null
    : null;

export function adjacentSlide(deck, selected, step) {
  const slides = flattenSlides(deck);
  if (!slides.length) return null;
  const current = slides.findIndex(entry => entry.slide.id === selected?.slideId);
  const index = current < 0
    ? (step > 0 ? 0 : slides.length - 1)
    : (current + step + slides.length) % slides.length;
  return slides[index];
}

export function sectionSlide(deck, selected, step) {
  const sets = deck.presentations.filter(presentation => presentation.slides.length);
  if (!sets.length) return null;
  const current = sets.findIndex(presentation => presentation.id === selected?.presentationId);
  const index = current < 0
    ? (step > 0 ? 0 : sets.length - 1)
    : (current + step + sets.length) % sets.length;
  const presentation = sets[index];
  return { presentation, slide: presentation.slides[0] };
}

export function moveById(items, sourceId, targetId, side = "before") {
  if (sourceId === targetId) return items;
  const source = items.find(item => item.id === sourceId);
  if (!source || !items.some(item => item.id === targetId)) return items;
  const next = items.filter(item => item.id !== sourceId);
  const targetIndex = next.findIndex(item => item.id === targetId);
  next.splice(targetIndex + (side === "after" ? 1 : 0), 0, source);
  return next;
}

function chunk(lines) {
  const size = lines.length % 5 === 0 ? 5 : lines.length % 3 === 0 ? 3 : 4;
  const chunks = [];
  for (let index = 0; index < lines.length; index += size) chunks.push(lines.slice(index, index + size));
  return chunks;
}

function extractAttribution(text) {
  const lines = cleanText(text).split("\n");
  let index = lines.findIndex(line => /song #/i.test(line));
  if (index < 0) return { body: cleanText(text), attribution: "" };
  if (index >= 2 && lines[index - 1].trim() && !lines[index - 2].trim()) index--;
  return {
    body: lines.slice(0, index).join("\n").trimEnd(),
    attribution: lines.slice(index).join("\n").trim()
  };
}

export function parseOutline(text) {
  const { body, attribution } = extractAttribution(text);
  const matches = [...body.matchAll(HEADING)];
  const sections = matches.map((match, index) => ({
    title: match[0].trim(),
    content: body.slice(match.index + match[0].length, matches[index + 1]?.index ?? body.length).trim()
  })).filter(section => section.content);
  const slides = sections.flatMap(section =>
    chunk(section.content.split("\n").filter(line => line.trim())).map(lines => ({
      title: section.title,
      content: lines.join("\n")
    }))
  );
  return { attribution, sections, slides, shouldSplit: slides.length > 1 };
}

export const tagColor = label => {
  const key = String(label ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!key) return "#27282c";
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
};

export const activePositionBank = screen =>
  screen.videoMode === "off" ? "withoutVideo" : "withVideo";

export const textScaleCqw = screen => {
  const safeHeight = screen.height * (1 - TEXT_LAYOUT.safeTop - TEXT_LAYOUT.safeBottom);
  const logicalSize = safeHeight * TEXT_LAYOUT.safety / (screen.textRows * TEXT_LAYOUT.lineHeight);
  return 100 * logicalSize / screen.width;
};

const slideCopy = entry => ({
  text: entry?.slide.content ?? "",
  attribution: entry?.slideIndex === 0 ? entry.presentation.attribution : ""
});

export function resolveScreenComposition(screen, entry) {
  return {
    width: screen.width,
    height: screen.height,
    videoMode: screen.videoMode,
    textPosition: screen.textPositions[activePositionBank(screen)],
    textRows: screen.textRows,
    ...slideCopy(entry)
  };
}

export function resolveThumbnailComposition(screen, presentation, slide, slideIndex) {
  return {
    width: screen?.width ?? DEFAULT_SCREEN_SIZE.width,
    height: screen?.height ?? DEFAULT_SCREEN_SIZE.height,
    videoMode: "off",
    textPosition: screen?.textPositions?.withoutVideo ?? "center-center",
    textRows: screen?.textRows ?? 8,
    text: slide.content,
    attribution: slideIndex === 0 ? presentation.attribution : ""
  };
}

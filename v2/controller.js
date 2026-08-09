import { batch, createEffect, createMemo, createSignal, untrack } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { createHistory } from "./history.js";
import {
  DEFAULT_SCREEN_SIZE,
  DEFAULT_SLIDE_COLUMNS,
  POSITIONS,
  clamp,
  createPresentation,
  createScreen,
  createSlide,
  flattenSlides,
  moveById,
  normalizeDeck,
  normalizeWorkspace,
  reconcileCollapsedSetIds,
  sampleDeck,
  selectedEntry
} from "./model.js";

const parseStored = (storage, key) => {
  const value = storage.get(key);
  return value ? JSON.parse(value) : null;
};

export function hydrateController({ storage, storageKeys, newId, includeLegacy = true }) {
  let deck;
  let workspace;
  let notice = "";

  for (const key of includeLegacy ? [storageKeys.deck, storageKeys.legacyDeck] : [storageKeys.deck]) {
    try {
      const value = parseStored(storage, key);
      if (value) {
        deck = normalizeDeck(value, newId);
        break;
      }
    } catch (error) {
      notice = `Ignoring invalid ${key} deck: ${error.message}`;
    }
  }

  try {
    workspace = normalizeWorkspace(parseStored(storage, storageKeys.workspace), newId);
  } catch {
    workspace = normalizeWorkspace(null, newId);
  }

  const hydratedDeck = deck ?? sampleDeck(newId);
  return {
    deck: hydratedDeck,
    workspace: {
      ...workspace,
      collapsedSetIds: reconcileCollapsedSetIds(hydratedDeck, workspace.collapsedSetIds)
    },
    notice
  };
}

export function createController({ initialDeck, initialWorkspace, storage, storageKeys, newId, initialNotice = "" }) {
  const normalizedDeck = normalizeDeck(initialDeck, newId);
  const normalizedWorkspace = normalizeWorkspace(initialWorkspace, newId);
  normalizedWorkspace.collapsedSetIds = reconcileCollapsedSetIds(normalizedDeck, normalizedWorkspace.collapsedSetIds);
  const [deckState, setDeck] = createStore(normalizedDeck);
  const [workspaceState, setWorkspace] = createStore(normalizedWorkspace);
  const [selection, setSelection] = createSignal(null);
  const [deckStatus, setDeckStatus] = createSignal(initialNotice);
  const [workspaceStatus, setWorkspaceStatus] = createSignal("");

  const snapshot = () => structuredClone(unwrap(deckState));
  const restore = value => {
    const next = normalizeDeck(value, newId);
    batch(() => {
      setDeck(reconcile(next));
      setWorkspace("collapsedSetIds", ids => reconcileCollapsedSetIds(next, ids));
      if (!selectedEntry(next, selection())) setSelection(null);
    });
  };
  const history = createHistory({ snapshot, apply: restore });

  const setPresentation = (id, ...path) =>
    setDeck("presentations", presentation => presentation.id === id, ...path);
  const setScreen = (id, ...path) =>
    setWorkspace("screens", screen => screen.id === id, ...path);
  const edit = change => {
    change();
    history.touch();
  };
  const liveEntry = createMemo(() => selectedEntry(deckState, selection()));
  const labels = createMemo(() => [...new Set(
    flattenSlides(deckState).map(entry => entry.slide.title).filter(Boolean)
  )].sort((left, right) => left.localeCompare(right)));
  const referenceScreen = createMemo(() =>
    workspaceState.screens.find(screen => screen.id === workspaceState.previewScreenId)
      ?? workspaceState.screens[0]
      ?? null
  );

  const select = (presentationId, slideId) => {
    if (!deckState.presentations.some(presentation =>
      presentation.id === presentationId && presentation.slides.some(slide => slide.id === slideId)
    )) return false;
    setSelection({ presentationId, slideId });
    return true;
  };
  const selectEntry = entry => {
    if (entry) return select(entry.presentation.id, entry.slide.id);
    setSelection(null);
    return true;
  };

  const deck = {
    state: deckState,
    status: deckStatus,
    labels,
    report: setDeckStatus,
    setTitle: value => edit(() => setDeck("title", value)),
    setPresentationTitle: (id, value) => edit(() => setPresentation(id, "title", value)),
    setPresentationAttribution: (id, value) => edit(() => setPresentation(id, "attribution", value)),
    setSlideTitle: (presentationId, slideId, value) => edit(() =>
      setPresentation(presentationId, "slides", slide => slide.id === slideId, "title", value)
    ),
    setSlideContent: (presentationId, slideId, value) => edit(() =>
      setPresentation(presentationId, "slides", slide => slide.id === slideId, "content", value)
    ),
    addPresentation: () => history.run("Add set", () => {
      const presentation = createPresentation(newId);
      setDeck("presentations", items => [...items, presentation]);
      return { presentationId: presentation.id, slideId: presentation.slides[0].id };
    }),
    removePresentation: id => history.run("Remove set", () => {
      const exists = deckState.presentations.some(presentation => presentation.id === id);
      if (!exists) return false;
      const clearsCue = selection()?.presentationId === id;
      batch(() => {
        setDeck("presentations", items => items.filter(item => item.id !== id));
        setWorkspace("collapsedSetIds", items => items.filter(item => item !== id));
        if (clearsCue) setSelection(null);
      });
      return true;
    }),
    movePresentation: (sourceId, targetId, side) => history.run("Reorder set", () => {
      const before = deckState.presentations;
      const next = moveById(before, sourceId, targetId, side);
      if (next === before) return false;
      setDeck("presentations", next);
      return true;
    }),
    addSlide: presentationId => history.run("Add slide", () => {
      const presentation = deckState.presentations.find(item => item.id === presentationId);
      if (!presentation) return null;
      const slide = createSlide(newId);
      setPresentation(presentationId, "slides", items => [...items, slide]);
      return slide.id;
    }),
    removeSlide: (presentationId, slideId) => history.run("Remove slide", () => {
      const presentation = deckState.presentations.find(item => item.id === presentationId);
      if (!presentation?.slides.some(slide => slide.id === slideId)) return false;
      batch(() => {
        setPresentation(presentationId, "slides", items => items.filter(item => item.id !== slideId));
        if (selection()?.slideId === slideId) setSelection(null);
      });
      return true;
    }),
    moveSlide: (presentationId, sourceId, targetId, side) => history.run("Reorder slide", () => {
      const presentation = deckState.presentations.find(item => item.id === presentationId);
      if (!presentation) return false;
      const next = moveById(presentation.slides, sourceId, targetId, side);
      if (next === presentation.slides) return false;
      setPresentation(presentationId, "slides", next);
      return true;
    }),
    splitSlide: (presentationId, slideId, parsed) => history.run("Split paste", () => {
      const presentation = deckState.presentations.find(item => item.id === presentationId);
      const index = presentation?.slides.findIndex(slide => slide.id === slideId) ?? -1;
      if (index < 0 || !parsed.slides.length) return [];
      const slides = parsed.slides.map(item => createSlide(newId, item.title, item.content));
      batch(() => {
        setPresentation(presentationId, "slides", items => {
          const next = [...items];
          next.splice(index, 1, ...slides);
          return next;
        });
        if (parsed.attribution) setPresentation(presentationId, "attribution", parsed.attribution);
        if (selection()?.slideId === slideId) select(presentationId, slides[0].id);
      });
      setDeckStatus(`Split into ${slides.length} slides.`);
      return slides.map(slide => slide.id);
    }),
    replace: (input, message = "Deck imported.", label = "Import deck") => {
      const normalized = normalizeDeck(input, newId);
      return history.run(label, () => {
        batch(() => {
          setDeck(reconcile(normalized));
          setWorkspace("collapsedSetIds", ids => reconcileCollapsedSetIds(normalized, ids));
          setSelection(null);
          setDeckStatus(message);
        });
        return true;
      });
    },
    reset: () => deck.replace(sampleDeck(newId), "Tutorial restored.", "Reset tutorial"),
    exportPayload: () => ({
      filename: `${(deckState.title || "deck").replace(/[^a-z0-9._-]+/gi, "-")}.json`,
      text: JSON.stringify(unwrap(deckState), null, 2)
    })
  };

  const workspace = {
    state: workspaceState,
    status: workspaceStatus,
    referenceScreen,
    isSetCollapsed: id => workspaceState.collapsedSetIds.includes(id),
    setSetCollapsed: (id, collapsed) => {
      if (!deckState.presentations.some(presentation => presentation.id === id)) return false;
      const isCollapsed = workspaceState.collapsedSetIds.includes(id);
      const next = Boolean(collapsed);
      if (isCollapsed === next) return false;
      setWorkspace("collapsedSetIds", ids => next
        ? [...ids, id]
        : ids.filter(item => item !== id)
      );
      return true;
    },
    addScreen: () => {
      const screen = createScreen(newId, `Screen ${workspaceState.screens.length + 1}`, referenceScreen() ?? DEFAULT_SCREEN_SIZE);
      batch(() => {
        setWorkspace("screens", items => [...items, screen]);
        if (!workspaceState.previewScreenId) setWorkspace("previewScreenId", screen.id);
      });
      return screen.id;
    },
    removeScreen: id => {
      const remaining = workspaceState.screens.filter(screen => screen.id !== id);
      if (remaining.length === workspaceState.screens.length) return false;
      batch(() => {
        setWorkspace("screens", remaining);
        if (workspaceState.previewScreenId === id) setWorkspace("previewScreenId", remaining[0]?.id ?? null);
      });
      return true;
    },
    renameScreen: (id, value) => setScreen(id, "label", value),
    setScreenWidth: (id, value) => setScreen(id, "width", clamp(value, 1, Number.MAX_SAFE_INTEGER, DEFAULT_SCREEN_SIZE.width)),
    setScreenHeight: (id, value) => setScreen(id, "height", clamp(value, 1, Number.MAX_SAFE_INTEGER, DEFAULT_SCREEN_SIZE.height)),
    setVideoEnabled: (id, enabled) => setScreen(id, "videoEnabled", Boolean(enabled)),
    setVideoMode: (id, mode) => setScreen(id, "videoMode", ["cover", "contain"].includes(mode) ? mode : "cover"),
    setTextPosition: (id, bank, position) => {
      if (!["withoutVideo", "withVideo"].includes(bank) || !POSITIONS.includes(position)) return;
      setScreen(id, "textPositions", bank, position);
    },
    setTextRows: (id, rows) => setScreen(id, "textRows", clamp(rows, 1, 20, 8)),
    setSlideColumns: value => setWorkspace("slideColumns", clamp(value, 2, 10, DEFAULT_SLIDE_COLUMNS)),
    setPreviewScreen: id => {
      if (workspaceState.screens.some(screen => screen.id === id)) setWorkspace("previewScreenId", id);
    }
  };

  const cue = {
    selection,
    entry: liveEntry,
    select,
    selectEntry,
    clear: () => setSelection(null)
  };

  const persist = (key, value, status, setStatus, label) => createEffect(() => {
    try {
      storage.set(key, value());
      if (untrack(status).startsWith(`${label} failed:`)) setStatus("");
    } catch (error) {
      setStatus(`${label} failed: ${error.message}`);
    }
  });
  persist(storageKeys.deck, () => JSON.stringify(deckState), deckStatus, setDeckStatus, "Save");
  persist(storageKeys.workspace, () => JSON.stringify(workspaceState), workspaceStatus, setWorkspaceStatus, "Workspace save");

  return { deck, workspace, cue, history };
}

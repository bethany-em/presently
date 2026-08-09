import { createRoot } from "solid-js";
import { mount } from "./app.js";
import { createController, hydrateController } from "./controller.js";
import { createMediaController } from "./media.js";
import { createOutputController } from "./outputs.js";
import * as domain from "./model.js";

const wait = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const editText = (element, value, inputType = "insertText") => {
  if (element.matches("[contenteditable]")) element.innerText = value;
  else element.value = value;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
};
const press = (target, key, options = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
const chooseFile = (input, name, content) => {
  const transfer = new DataTransfer();
  transfer.items.add(new File([content], name, { type: "application/json" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};
const dragTo = (source, target, coordinates) => {
  const transfer = new DataTransfer();
  source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer, ...coordinates }));
  target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
};

const until = async (condition, message) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error(message);
};
const ids = prefix => {
  let index = 0;
  return () => `${prefix}-${++index}`;
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const fakeStream = (apply = async () => {}) => {
  const listeners = new Map();
  const constraints = [];
  const track = {
    stopped: false,
    stop() { this.stopped = true; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    async applyConstraints(value) {
      constraints.push(value);
      await apply(value);
    }
  };
  return {
    stream: { getTracks: () => [track], getVideoTracks: () => [track] },
    track,
    constraints,
    end: () => listeners.get("ended")?.()
  };
};

const own = factory => {
  let value;
  let dispose;
  createRoot(rootDispose => {
    dispose = rootDispose;
    value = factory();
  });
  return { value, dispose };
};

export async function runTests(app) {
  const { commands: actions, fixtures: { controller, media, storageKeys }, queries } = app;
  const deck = queries.deck();
  const workspace = queries.workspace();
  const selected = queries.selection;
  const editing = queries.editing;
  const focusedSlideId = queries.focusedSlideId;
  const history = controller.history;
  const tests = [];
  const test = (name, run) => tests.push([name, run]);
  const reset = async () => {
    actions.resetDeck();
    actions.editing(false);
    media.clearSelection();
    history.clear();
    await wait();
  };

  test("normalizes legacy data and repairs identity", () => {
    const makeId = ids("new");
    const normalized = domain.normalizeDeck({
      id: "same",
      title: " Legacy ",
      presentations: [{ id: "same", title: "Set", slides: [{ id: "same", content: "Line\n" }] }]
    }, makeId);
    const all = [normalized.id, normalized.presentations[0].id, normalized.presentations[0].slides[0].id];
    assert(normalized.version === 2 && normalized.title === " Legacy", "legacy fields were not preserved");
    assert(new Set(all).size === all.length && normalized.presentations[0].slides[0].content === "Line", "identity or text repair failed");
  });

  test("imports every durable v1 deck field without changing v1", () => {
    const savedV2 = localStorage.getItem(storageKeys.deck);
    const savedV1 = localStorage.getItem(storageKeys.legacyDeck);
    const legacy = {
      title: "Imported v1",
      presentations: [{ title: "Set", attribution: "Credit", slides: [{ title: "Verse", content: "Words" }] }]
    };
    try {
      localStorage.removeItem(storageKeys.deck);
      localStorage.setItem(storageKeys.legacyDeck, JSON.stringify(legacy));
      const imported = hydrateController({
        storage: {
          get: key => localStorage.getItem(key),
          set: (key, value) => localStorage.setItem(key, value)
        },
        storageKeys,
        newId: ids("legacy"),
        includeLegacy: true
      }).deck;
      assert(imported.title === legacy.title && imported.presentations[0].title === "Set", "deck or set title was lost");
      assert(imported.presentations[0].attribution === "Credit" && imported.presentations[0].slides[0].content === "Words", "attribution or slide data was lost");
      assert(localStorage.getItem(storageKeys.legacyDeck) === JSON.stringify(legacy), "v1 storage was modified");
    } finally {
      savedV2 === null ? localStorage.removeItem(storageKeys.deck) : localStorage.setItem(storageKeys.deck, savedV2);
      savedV1 === null ? localStorage.removeItem(storageKeys.legacyDeck) : localStorage.setItem(storageKeys.legacyDeck, savedV1);
    }
  });

  test("migrates legacy screen settings and clamps controls", () => {
    const defaults = domain.normalizeWorkspace({ screens: [], slideColumns: "invalid" }, ids("default-screen"));
    const migrated = domain.normalizeWorkspace({
      fitVideo: true,
      slideColumns: 99,
      previewScreenId: "missing",
      collapsedSetIds: ["a", "a", " ", 7],
      screens: [{ id: "a", label: "Audience", video: true, textRows: 0, width: 1024, height: 768 }]
    }, ids("screen"));
    assert(defaults.slideColumns === 3, "workspace did not default to three deck columns");
    assert(migrated.slideColumns === 10 && migrated.previewScreenId === "a"
      && migrated.collapsedSetIds.join() === "a", "workspace range, reference, or collapse migration failed");
    assert(migrated.screens[0].videoMode === "contain" && migrated.screens[0].textRows === 1, "legacy video or rows migration failed");
  });

  test("hydrates collapse state by stable set id", () => {
    const values = new Map();
    const storage = {
      get: key => values.get(key) ?? null,
      set: (key, value) => values.set(key, value)
    };
    const keys = { deck: "deck", legacyDeck: "legacy", workspace: "workspace" };
    const initialDeck = domain.normalizeDeck({
      id: "deck",
      title: "Saved deck",
      presentations: [
        { id: "first", title: "First", slides: [{ id: "slide", content: "Words" }] },
        { id: "second", title: "Second", slides: [] }
      ]
    }, ids("hydrate"));
    const initialWorkspace = domain.normalizeWorkspace({ screens: [], collapsedSetIds: [] }, ids("screen"));
    const owned = own(() => createController({
      initialDeck,
      initialWorkspace,
      storage,
      storageKeys: keys,
      newId: ids("persist")
    }));

    owned.value.workspace.setSetCollapsed("first", true);
    const storedWorkspace = JSON.parse(values.get(keys.workspace));
    storedWorkspace.collapsedSetIds.push("missing");
    values.set(keys.workspace, JSON.stringify(storedWorkspace));
    owned.dispose();

    const hydrated = hydrateController({
      storage,
      storageKeys: keys,
      newId: ids("reload"),
      includeLegacy: false
    });
    assert(hydrated.workspace.collapsedSetIds.join() === "first",
      "fresh hydration did not restore valid collapse state or discard unknown ids");
  });

  test("parses section paste without losing attribution", () => {
    const parsed = domain.parseOutline("Verse 1\nOne\nTwo\nThree\nChorus\nSing\nAgain\nSong #123\nWriter Name");
    assert(parsed.shouldSplit && parsed.slides.length === 2, "sections did not split");
    assert(parsed.slides[0].title === "Verse 1" && parsed.slides[1].content === "Sing\nAgain", "headings leaked into content");
    assert(parsed.attribution === "Song #123\nWriter Name", "attribution was lost");
  });

  test("navigates across sets and from standby", () => {
    const model = domain.normalizeDeck({
      presentations: [
        { title: "First", slides: [{ content: "One" }, { content: "Two" }] },
        { title: "Second", slides: [{ content: "Three" }] }
      ]
    }, ids("deck"));
    const flat = domain.flattenSlides(model);
    const lastFirstSet = model.presentations[0].slides.at(-1);
    const across = domain.adjacentSlide(model, { slideId: lastFirstSet.id }, 1);
    assert(across.presentationIndex === 1 && across.slideIndex === 0, "next did not cross a set boundary");
    assert(domain.adjacentSlide(model, null, -1).slide.id === flat.at(-1).slide.id, "standby reverse did not select the last slide");
    assert(domain.sectionSlide(model, null, 1).presentation.id === model.presentations[0].id, "standby did not enter first set");
  });

  test("reorders immutable lists by stable id", () => {
    const input = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const moved = domain.moveById(input, "a", "c", "after");
    assert(moved.map(item => item.id).join("") === "bca" && input.map(item => item.id).join("") === "abc", "stable-id move mutated or misplaced data");
  });

  test("keeps labels visually stable and normalized", () => {
    assert(domain.tagColor(" Verse  1 ") === domain.tagColor("verse 1"), "equivalent labels received different colors");
    assert(domain.tagColor("Verse 1") !== domain.tagColor("Chorus"), "common groups were not distinguishable");
  });

  test("composes blank standby and first-slide attribution", () => {
    const screen = workspace.screens[0];
    const blank = domain.resolveScreenComposition(screen, null);
    const first = domain.flattenSlides(deck)[0];
    const live = domain.resolveScreenComposition(screen, first);
    assert(blank.text === "" && blank.attribution === "", "standby still rendered copy");
    assert(live.text === first.slide.content && live.attribution === first.presentation.attribution, "live composition omitted slide copy");
  });

  test("scales text by rows and physical aspect ratio", () => {
    const base = { ...workspace.screens[0], textRows: 8 };
    const fewerRows = domain.textScaleCqw({ ...base, textRows: 4 });
    const narrow = domain.textScaleCqw({ ...base, width: 1024, height: 768 });
    assert(Math.abs(fewerRows / domain.textScaleCqw(base) - 2) < .001, "row scale was not inverse");
    assert(narrow > domain.textScaleCqw(base), "custom aspect ratio did not change width-relative type scale");
  });

  test("never starts deferred media after disposal", async () => {
    let scheduled;
    let calls = 0;
    const owned = own(() => createMediaController({
      defer: callback => scheduled = callback,
      mediaDevices: () => ({
        getUserMedia: async () => { calls++; return fakeStream().stream; },
        enumerateDevices: async () => []
      })
    }));
    owned.value.start();
    owned.dispose();
    scheduled();
    await Promise.resolve();
    assert(calls === 0, "disposed eager startup still requested a camera");
  });

  test("stops partial and late camera results on disposal", async () => {
    const probe = fakeStream();
    const first = fakeStream();
    const second = fakeStream();
    const captures = [deferred(), deferred()];
    let captureIndex = 0;
    const owned = own(() => createMediaController({
      mediaDevices: () => ({
        getUserMedia: constraints => constraints.video === true
          ? Promise.resolve(probe.stream)
          : captures[captureIndex++].promise,
        enumerateDevices: async () => [
          { kind: "videoinput", deviceId: "one", label: "One" },
          { kind: "videoinput", deviceId: "two", label: "Two" }
        ]
      })
    }));
    const refresh = owned.value.refreshCameras();
    await until(() => captureIndex === 2, "camera requests did not start");
    captures[0].resolve(first.stream);
    await Promise.resolve();
    await Promise.resolve();
    owned.dispose();
    assert(first.track.stopped, "resolved partial camera survived root disposal");
    captures[1].resolve(second.stream);
    await refresh;
    assert(second.track.stopped && probe.track.stopped, "late camera or permission probe survived disposal");
  });

  test("makes media disposal a terminal browser boundary", async () => {
    let deviceReads = 0;
    const owned = own(() => createMediaController({
      mediaDevices: () => {
        deviceReads++;
        return {};
      }
    }));
    owned.dispose();
    assert(!await owned.value.refreshCameras() && !await owned.value.shareDisplay() && deviceReads === 0,
      "a disposed media controller still touched the browser device boundary");
  });

  test("does not stop a camera retained by exact stream identity", async () => {
    const probes = [fakeStream(), fakeStream()];
    const camera = fakeStream();
    let probeIndex = 0;
    const owned = own(() => createMediaController({
      mediaDevices: () => ({
        getUserMedia: constraints => Promise.resolve(
          constraints.video === true ? probes[probeIndex++].stream : camera.stream
        ),
        enumerateDevices: async () => [{ kind: "videoinput", deviceId: "room", label: "Room" }]
      })
    }));
    await owned.value.refreshCameras();
    await owned.value.refreshCameras();
    assert(owned.value.cameras()[0].stream === camera.stream && !camera.track.stopped,
      "refresh stopped the stream it retained as the current camera");
    owned.dispose();
    assert(camera.track.stopped, "retained camera survived terminal disposal");
  });

  test("promotes only the selected camera and restores preview quality", async () => {
    const probe = fakeStream();
    const first = fakeStream();
    const second = fakeStream();
    let cameraIndex = 0;
    let captures = 0;
    const owned = own(() => createMediaController({
      mediaDevices: () => ({
        getUserMedia: async constraints => {
          captures++;
          if (constraints.video === true) return probe.stream;
          return [first, second][cameraIndex++].stream;
        },
        enumerateDevices: async () => [
          { kind: "videoinput", deviceId: "one", label: "One" },
          { kind: "videoinput", deviceId: "two", label: "Two" }
        ]
      })
    }));
    const media = owned.value;
    await media.refreshCameras();

    media.toggleSource(media.cameras()[0].key);
    await until(() => first.constraints.length === 1, "selected camera was not promoted");
    assert(first.constraints[0].width.ideal === 1920 && first.constraints[0].height.ideal === 1080
      && first.constraints[0].frameRate.ideal === 30, "selected camera missed program-quality constraints");
    assert(media.selected().stream === first.stream && captures === 3,
      "promotion replaced the inventory stream or opened a duplicate capture");

    media.toggleSource(media.cameras()[1].key);
    await until(() => first.constraints.length === 2 && second.constraints.length === 1,
      "camera switch did not retune both streams");
    assert(first.constraints[1].width.ideal === 640 && first.constraints[1].height.ideal === 360
      && first.constraints[1].frameRate.ideal === 15, "previous camera did not return to preview quality");
    assert(second.constraints[0].width.ideal === 1920 && second.constraints[0].height.ideal === 1080,
      "newly selected camera was not promoted");

    media.clearSelection();
    await until(() => second.constraints.length === 2, "cleared camera did not return to preview quality");
    assert(second.constraints[1].width.ideal === 640 && media.selected() === null,
      "clearing selection left a program-quality camera active");
    owned.dispose();
  });

  test("serializes camera tuning and reconciles the latest selection", async () => {
    const probe = fakeStream();
    const changes = [];
    const camera = fakeStream(constraints => {
      const change = deferred();
      changes.push({ constraints, ...change });
      return change.promise;
    });
    const owned = own(() => createMediaController({
      mediaDevices: () => ({
        getUserMedia: async constraints => constraints.video === true ? probe.stream : camera.stream,
        enumerateDevices: async () => [{ kind: "videoinput", deviceId: "room", label: "Room" }]
      })
    }));
    const media = owned.value;
    await media.refreshCameras();
    media.toggleSource(media.cameras()[0].key);
    await until(() => changes.length === 1, "program tuning did not begin");
    media.clearSelection();
    assert(changes.length === 1, "one camera received overlapping constraint changes");
    changes[0].resolve();
    await until(() => changes.length === 2, "stale promotion was not reconciled");
    assert(changes[1].constraints.width.ideal === 640, "latest preview intent did not win");
    changes[1].resolve();
    await Promise.resolve();
    owned.dispose();
  });

  test("promotes the replacement when a selected camera refreshes", async () => {
    const probes = [fakeStream(), fakeStream()];
    const cameras = [fakeStream(), fakeStream()];
    let generation = -1;
    const owned = own(() => createMediaController({
      mediaDevices: () => ({
        getUserMedia: async constraints => constraints.video === true
          ? probes[++generation].stream
          : cameras[generation].stream,
        enumerateDevices: async () => [{ kind: "videoinput", deviceId: "room", label: "Room" }]
      })
    }));
    const media = owned.value;
    await media.refreshCameras();
    media.toggleSource(media.cameras()[0].key);
    await until(() => cameras[0].constraints.length === 1, "initial selected camera was not promoted");

    await media.refreshCameras();
    await until(() => cameras[1].constraints.length === 1, "replacement selected camera was not promoted");
    assert(media.selected().stream === cameras[1].stream && cameras[1].constraints[0].width.ideal === 1920,
      "refresh lost selected camera quality or stream identity");
    assert(cameras[0].track.stopped, "refresh left the old program-quality camera running");
    owned.dispose();
  });

  test("keeps preview video live when high-quality tuning fails", async () => {
    const probe = fakeStream();
    const camera = fakeStream(async () => { throw new Error("unsupported mode"); });
    const owned = own(() => createMediaController({
      mediaDevices: () => ({
        getUserMedia: async constraints => constraints.video === true ? probe.stream : camera.stream,
        enumerateDevices: async () => [{ kind: "videoinput", deviceId: "room", label: "Room" }]
      })
    }));
    const media = owned.value;
    await media.refreshCameras();
    media.toggleSource(media.cameras()[0].key);
    await until(() => media.status().includes("using preview quality"), "quality fallback was not reported");
    assert(media.selected().stream === camera.stream && !camera.track.stopped,
      "failed quality tuning interrupted the selected preview stream");
    owned.dispose();
  });

  test("does not adopt a camera that ends during refresh", async () => {
    const probe = fakeStream();
    const first = fakeStream();
    const second = fakeStream();
    const captures = [deferred(), deferred()];
    let captureIndex = 0;
    const owned = own(() => createMediaController({
      mediaDevices: () => ({
        getUserMedia: constraints => constraints.video === true
          ? Promise.resolve(probe.stream)
          : captures[captureIndex++].promise,
        enumerateDevices: async () => [
          { kind: "videoinput", deviceId: "one", label: "One" },
          { kind: "videoinput", deviceId: "two", label: "Two" }
        ]
      })
    }));
    const refresh = owned.value.refreshCameras();
    await until(() => captureIndex === 2, "camera requests did not start");
    captures[0].resolve(first.stream);
    await Promise.resolve();
    await Promise.resolve();
    first.end();
    captures[1].resolve(second.stream);
    await refresh;
    assert(owned.value.cameras().length === 1 && owned.value.cameras()[0].stream === second.stream,
      "an already-ended camera entered the inventory");
    owned.dispose();
  });

  test("retires exact ended sources without disturbing newer selection", async () => {
    const probe = fakeStream();
    const camera = fakeStream();
    const displays = [fakeStream(), fakeStream()];
    let displayIndex = 0;
    const owned = own(() => createMediaController({
      mediaDevices: () => ({
        getUserMedia: constraints => Promise.resolve(constraints.video === true ? probe.stream : camera.stream),
        enumerateDevices: async () => [{ kind: "videoinput", deviceId: "room", label: "Room" }],
        getDisplayMedia: async () => displays[displayIndex++].stream
      })
    }));
    const media = owned.value;
    await media.refreshCameras();
    await media.shareDisplay();
    media.toggleSource(media.cameras()[0].key);
    displays[0].end();
    assert(media.display() === null && media.selected()?.stream === camera.stream,
      "inactive ended display stayed visible or cleared the selected camera");

    await media.shareDisplay();
    const replacement = media.display();
    displays[0].end();
    assert(media.display() === replacement && media.selected() === replacement,
      "a late ended event removed the replacement source");
    owned.dispose();
  });

  test("matches output disconnects by exact target and sends cached state", () => {
    let bridge;
    let bridgeRemoved = false;
    let sendFails = false;
    const host = {
      installControllerBridge(connect, disconnect) {
        bridge = { connect, disconnect };
        return () => bridgeRemoved = true;
      },
      isClosed: target => Boolean(target.closed),
      send: (target, payload) => {
        if (sendFails) return false;
        target.payload = payload;
        return true;
      },
      open: () => null,
      focus() {},
      close(target) { target.closed = true; }
    };
    const owned = own(() => createOutputController(host));
    owned.value.publish([{ screenId: "screen", label: "Screen", composition: {}, source: null }]);
    const oldTarget = { closed: false };
    const currentTarget = { closed: false };
    assert(bridge.connect(oldTarget, "screen") && oldTarget.payload.label === "Screen", "late viewer missed cached state");
    bridge.connect(currentTarget, "screen");
    bridge.disconnect(oldTarget, "screen");
    assert(owned.value.openIds().includes("screen"), "stale disconnect removed the current viewer");
    bridge.disconnect(currentTarget, "screen");
    assert(!owned.value.openIds().length, "exact disconnect left a stale viewer");
    bridge.connect(currentTarget, "screen");
    sendFails = true;
    owned.value.publish([{ screenId: "screen", label: "Updated", composition: {}, source: null }]);
    assert(!owned.value.openIds().length && owned.value.statusFor("screen").includes("lost"),
      "a failed reactive publish silently dropped the output connection");
    sendFails = false;
    bridge.connect(currentTarget, "screen");
    sendFails = true;
    assert(!owned.value.open({ id: "screen" }) && !owned.value.openIds().length
      && owned.value.statusFor("screen").includes("lost"),
    "a failed send left a stale output marked open");
    owned.dispose();
    assert(bridgeRemoved, "output bridge survived disposal");
  });

  test("keeps in-memory editing usable when storage is denied", async () => {
    const storage = {
      get() { throw new Error("denied"); },
      set() { throw new Error("denied"); }
    };
    const makeId = ids("denied");
    const hydrated = hydrateController({
      storage,
      storageKeys: { deck: "deck", workspace: "workspace", legacyDeck: "legacy" },
      newId: makeId
    });
    const owned = own(() => createController({
      initialDeck: hydrated.deck,
      initialWorkspace: hydrated.workspace,
      initialNotice: hydrated.notice,
      storage,
      storageKeys: { deck: "deck", workspace: "workspace" },
      newId: makeId
    }));
    owned.value.deck.setTitle("Still usable");
    await Promise.resolve();
    assert(owned.value.deck.state.title === "Still usable" && owned.value.deck.status().startsWith("Save failed:"),
      "storage denial blocked editing or missed its scoped status");
    owned.dispose();
  });

  test("mounts, disposes, and remounts one owned application", () => {
    const values = new Map();
    let activeBridges = 0;
    const environment = {
      newId: ids("remount"),
      defer: callback => queueMicrotask(callback),
      storage: {
        get: key => values.get(key) ?? null,
        set: (key, value) => values.set(key, value),
        remove: key => values.delete(key)
      },
      mediaDevices: () => undefined,
      confirm: () => false,
      download() {},
      outputHost: {
        installControllerBridge() { activeBridges++; return () => activeBridges--; },
        isClosed: target => Boolean(target?.closed),
        send: () => true,
        open: () => null,
        focus() {},
        close() {}
      }
    };
    const bootstrap = {
      testMode: true,
      screenId: null,
      storageKeys: { deck: "remount.deck", workspace: "remount.workspace", legacyDeck: "legacy" },
      includeLegacy: false
    };
    const root = document.body.appendChild(document.createElement("div"));
    try {
      const first = mount(root, environment, bootstrap);
      assert(first.app?.fixtures.controller && activeBridges === 1, "first mount did not create one application bridge");
      first.dispose();
      assert(!root.textContent && activeBridges === 0, "dispose left DOM or bridge ownership behind");
      const second = mount(root, environment, bootstrap);
      assert(second.app !== first.app && activeBridges === 1, "remount reused stale application state");
      second.dispose();
      assert(activeBridges === 0, "remounted bridge survived disposal");
    } finally {
      root.remove();
    }
  });

  test("renders the deck, truthful previews, and standby", async () => {
    await reset();
    assert(deck.presentations.length === 1 && deck.presentations[0].slides.length === 10,
      "tutorial was not one ten-slide set");
    assert(document.querySelectorAll(".slide-card").length === 10, "tutorial deck did not render");
    assert(deck.presentations[0].slides[1].content.includes("Click it again to clear it"), "tutorial omitted the cue toggle");
    assert(document.querySelectorAll("#slide-labels option").length === 10, "label suggestions did not reflect the deck");
    assert(document.querySelectorAll(".output-card").length === 2, "default screens did not render");
    assert(!document.querySelector(".slide-card.selected"), "boot unexpectedly cued a slide");
    assert([...document.querySelectorAll(".output-card .canvas-text")].every(node => !node.innerText), "standby preview was not blank");
  });

  test("keeps metadata and document structure live in Operate", async () => {
    await reset();
    const firstSet = deck.presentations[0];
    const firstSlide = firstSet.slides[0];
    const fields = [
      [document.querySelector(".deck-title"), "Working deck"],
      [document.querySelector(".presentation-title"), "Opening set"],
      [document.querySelector(".slide-caption input"), "Arrival"],
      [document.querySelector(".set-attribution"), "Written by A\nPerformed by B"],
      [document.querySelector(".screen-label"), "Main wall"]
    ];
    assert(!editing() && fields.every(([field]) => !field.readOnly),
      "Operate locked directly editable metadata");
    assert(document.querySelector('[data-test="undo"]')
      && document.querySelector('[data-test="add-set"]')
      && document.querySelector(".set-add")
      && document.querySelector(".set-move")
      && document.querySelector(".set-remove")
      && !document.querySelector(".set-menu")
      && !document.querySelector(".toolbar details")
      && [...document.querySelectorAll(".toolbar-actions button")].some(button => button.textContent === "Import")
      && [...document.querySelectorAll(".toolbar-actions button")].some(button => button.textContent === "Export")
      && [...document.querySelectorAll(".toolbar-actions button")].some(button => button.textContent === "Reset")
      && document.querySelector(".deck-size-controls")
      && document.querySelector(".screen-menu")
      && document.querySelector(".output-head button"),
    "Operate hid document or screen structure controls");
    assert(document.querySelectorAll(".presentation-head .edit-switch").length === deck.presentations.length
      && [...document.querySelectorAll(".edit-switch > span:first-child")].every(label => label.textContent === "Edit mode"),
    "sticky headers did not share the Edit mode switch");
    assert([...document.querySelectorAll(".presentation-head .set-add")]
      .every(button => button.nextElementSibling?.classList.contains("edit-switch")),
    "Add slide was not adjacent to Edit mode");
    const editSwitches = [...document.querySelectorAll(".edit-switch input")];
    editSwitches[1].click();
    await wait();
    assert(editing() && editSwitches.every(input => input.checked),
      "Edit mode switches did not share state");
    actions.editing(false);

    for (const [field, value] of fields) {
      field.focus();
      editText(field, value);
      field.blur();
    }
    await wait();
    assert(deck.title === "Working deck" && firstSet.title === "Opening set"
      && firstSlide.title === "Arrival" && firstSet.attribution === "Written by A\nPerformed by B"
      && workspace.screens[0].label === "Main wall",
    "Operate metadata edits did not reach their owners");
    assert(history.canUndo(), "Operate metadata edits were not undoable");

    actions.select(firstSet.id, firstSlide.id);
    document.querySelector('[aria-label="Remove slide"]').click();
    await wait();
    assert(selected() === null && !firstSet.slides.some(slide => slide.id === firstSlide.id),
      "Operate deletion did not remove and deselect the live slide");
    actions.undo();
    assert(firstSet.slides.some(slide => slide.id === firstSlide.id) && selected() === null && !editing(),
      "undoing Operate deletion did not safely restore standby");
  });

  test("renders small multiline attribution at the lower left", async () => {
    await reset();
    const firstSet = deck.presentations[0];
    actions.presentationAttribution(firstSet.id, "Written by A\nPerformed by B");
    actions.select(firstSet.id, firstSet.slides[0].id);
    await wait();
    const card = document.querySelector(".output-card");
    const attribution = card.querySelector(".attribution");
    const style = getComputedStyle(attribution);
    const wordsSize = parseFloat(getComputedStyle(card.querySelector(".canvas-text")).fontSize);
    assert(attribution.innerText === "Written by A\nPerformed by B", "attribution lost its line break");
    assert(style.insetInlineStart === "0px" && style.insetBlockEnd === "0px" && style.padding === "0px"
      && style.textAlign === "start" && style.whiteSpace === "pre-wrap",
    "attribution was not anchored flush to the lower left");
    assert(style.color.includes("0.55") && parseFloat(style.fontSize) < wordsSize,
      "attribution was not visually dim and subordinate");
  });

  test("cues immediately and gives double click explicit take-and-edit semantics", async () => {
    await reset();
    const [preview, next] = document.querySelectorAll(".slide-preview");
    preview.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    assert(selected()?.slideId === deck.presentations[0].slides[0].id, "single click did not cue synchronously");
    preview.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    assert(selected() === null, "clicking the live slide did not clear it synchronously");

    preview.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    next.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    assert(selected()?.slideId === deck.presentations[0].slides[1].id,
      "a rapid correction did not leave only the last clicked slide live");

    preview.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    preview.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    preview.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    await Promise.resolve();
    assert(editing() && selected()?.slideId === deck.presentations[0].slides[0].id
      && focusedSlideId() === deck.presentations[0].slides[0].id,
    "double click did not take the slide and enter global edit");

    preview.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    preview.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    preview.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    assert(!editing() && selected()?.slideId === deck.presentations[0].slides[0].id,
      "second double click did not leave edit and cue that slide");
  });

  test("edits slide text directly and persists it", async () => {
    actions.editing(true);
    await wait();
    const editor = document.querySelector(".slide-card .canvas-text");
    editText(editor, "Changed directly");
    await wait();
    assert(deck.presentations[0].slides[0].content === "Changed directly", "direct edit did not update the model");
    assert(JSON.parse(localStorage.getItem(storageKeys.deck)).presentations[0].slides[0].content === "Changed directly", "direct edit did not persist");
  });

  test("groups field edits and exposes safe top-bar history", async () => {
    await reset();
    const originalTitle = deck.title;
    const changedTitle = "History deck";
    const title = document.querySelector(".deck-title");
    const undo = document.querySelector('[data-test="undo"]');
    const redo = document.querySelector('[data-test="redo"]');
    assert(undo.disabled && redo.disabled, "empty history controls were not disabled");

    title.focus();
    editText(title, changedTitle);
    await wait();
    assert(!undo.disabled && history.undoLabel() === "Edit deck title", "active text transaction was not undoable");
    title.blur();

    const live = deck.presentations[0].slides[0];
    const workspaceBefore = JSON.stringify(workspace);
    actions.select(deck.presentations[0].id, live.id);
    undo.click();
    await wait();
    assert(deck.title === originalTitle && selected()?.slideId === live.id,
      "top-bar Undo changed runtime state or missed the field transaction");
    assert(JSON.stringify(workspace) === workspaceBefore && !redo.disabled,
      "Undo changed workspace state or did not expose Redo");

    press(window, "Z", { ctrlKey: true, shiftKey: true, cancelable: true });
    assert(deck.title === changedTitle, "Ctrl+Shift+Z did not redo");
    press(window, "z", { ctrlKey: true, cancelable: true });
    assert(deck.title === originalTitle, "Ctrl+Z did not undo");
    press(window, "y", { ctrlKey: true, cancelable: true });
    assert(deck.title === changedTitle, "Ctrl+Y did not redo");

    title.focus();
    editText(title, "Native field edit");
    press(title, "z", { ctrlKey: true, cancelable: true });
    assert(deck.title === "Native field edit", "global history hijacked a focused text field");
    title.blur();
    actions.undo();
    assert(deck.title === changedTitle, "field focus session was not one history command");

    title.focus();
    editText(title, changedTitle);
    title.blur();
    assert(history.canRedo(), "a no-op field session cleared the redo branch");

    title.focus();
    editText(title, "New branch");
    title.blur();
    assert(!history.canRedo(), "a new field edit did not clear the redo branch");

    actions.resetDeck();
    actions.undo();
    assert(deck.title === "New branch", "tutorial reset was not undoable");
    await wait();
    assert(!editing() && document.querySelector('[data-test="undo"]'),
      "history controls were not stable in Operate");
  });

  test("offers section splitting on paste and honors rejection", async () => {
    await reset();
    actions.editing(true);
    await wait();
    const originalConfirm = window.confirm;
    const editor = document.querySelector(".slide-card .canvas-text");
    const originalCount = deck.presentations[0].slides.length;
    const originalText = deck.presentations[0].slides[0].content;
    try {
      editor.focus();
      window.confirm = () => false;
      editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));
      editText(editor, "Verse 1\nOne\nChorus\nTwo", "insertFromPaste");
      await wait();
      assert(deck.presentations[0].slides.length === originalCount && deck.presentations[0].slides[0].content.includes("Chorus"), "rejected split did not keep one slide");
      window.confirm = () => true;
      editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));
      editText(editor, "Verse 1\nOne\nChorus\nTwo", "insertFromPaste");
      await wait();
      assert(deck.presentations[0].slides.length === originalCount + 1, "accepted split did not replace one slide with sections");
      actions.undo();
      assert(deck.presentations[0].slides.length === originalCount && deck.presentations[0].slides[0].content.includes("Chorus"),
        "undoing split did not preserve the unsplit paste");
      actions.undo();
      assert(deck.presentations[0].slides[0].content === originalText,
        "undoing the paste did not restore the pre-paste slide");
      actions.redo();
      actions.redo();
      assert(deck.presentations[0].slides.length === originalCount + 1,
        "redo did not restore the paste and split sequence");
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("does not let an unmatched paste taint later typing", async () => {
    await reset();
    actions.editing(true);
    await wait();
    const editor = document.querySelector(".slide-card .canvas-text");
    const originalConfirm = window.confirm;
    let confirmations = 0;
    try {
      window.confirm = () => { confirmations++; return true; };
      editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));
      await Promise.resolve();
      editText(editor, "Verse 1\nOne\nChorus\nTwo");
      await wait();
      assert(confirmations === 0 && deck.presentations[0].slides[0].content.includes("Chorus"),
        "typing inherited stale paste state");
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("uses global navigation without hijacking controls", async () => {
    await reset();
    const first = deck.presentations[0].slides[0];
    actions.select(deck.presentations[0].id, first.id);
    const title = document.querySelector(".deck-title");
    press(title, "ArrowRight");
    assert(selected().slideId === first.id, "input arrow changed the cue");
    press(window, "ArrowRight");
    await wait();
    assert(selected().slideId === deck.presentations[0].slides[1].id, "global next failed");
    press(window, "Escape");
    assert(selected() === null, "escape did not return to standby");
  });

  test("cues a focused slide with operate-mode keyboard controls", async () => {
    await reset();
    const preview = document.querySelector(".slide-preview");
    preview.focus();
    press(preview, "Enter", { cancelable: true });
    await wait();
    assert(selected()?.slideId === deck.presentations[0].slides[0].id, "Enter did not cue the focused card");
    press(preview, "Enter", { cancelable: true });
    assert(selected() === null, "Enter did not clear the focused live card");
  });

  test("deletes live content to standby and restores only document state", async () => {
    await reset();
    const firstSet = deck.presentations[0];
    actions.select(firstSet.id, firstSet.slides[0].id);
    const addedId = actions.addSlide(firstSet.id);
    actions.slideContent(firstSet.id, addedId, "Added");
    actions.moveSlide(firstSet.id, addedId, firstSet.slides[0].id, "before");
    assert(firstSet.slides[0].id === addedId, "slide did not move by identity");
    actions.select(firstSet.id, addedId);
    actions.removeSlide(firstSet.id, addedId);
    assert(selected() === null, "deleting the live slide did not enter standby");
    actions.undo();
    assert(firstSet.slides.some(slide => slide.id === addedId) && selected() === null,
      "undo did not restore the slide safely in standby");
    actions.redo();
    assert(!firstSet.slides.some(slide => slide.id === addedId) && selected() === null,
      "redo did not remove the slide safely in standby");

    const live = firstSet.slides[0];
    const unrelated = firstSet.slides[1];
    actions.select(firstSet.id, live.id);
    actions.removeSlide(firstSet.id, unrelated.id);
    assert(selected()?.slideId === live.id, "deleting unrelated content changed the live cue");

    actions.addPresentation();
    actions.removePresentation(firstSet.id);
    assert(selected() === null, "deleting the live set did not enter standby");
    actions.undo();
    assert(deck.presentations.some(set => set.id === firstSet.id) && selected() === null,
      "undoing a set deletion restored its former live cue");
  });

  test("collapses a set without changing the live cue", async () => {
    await reset();
    const slides = deck.presentations[0].slides;
    const slide = slides[0];
    actions.select(deck.presentations[0].id, slide.id);
    const presentation = document.querySelector(".presentation");
    presentation.querySelector(".collapse-toggle").click();
    await wait();
    const liveCue = presentation.querySelector(".set-live-cue");
    assert(!presentation.querySelector(".slide-grid") && selected()?.slideId === slide.id
      && liveCue && !liveCue.hidden && liveCue.textContent.includes("LIVE · 01"),
    "collapse changed the cue, left slides mounted, or hid the visible live state");
    presentation.querySelector(".collapse-toggle").click();
    await wait();
    assert(presentation.querySelectorAll(".slide-card").length === slides.length, "set did not expand again");
  });

  test("persists collapse state independently for each set", async () => {
    await reset();
    const firstId = deck.presentations[0].id;
    const secondId = actions.addPresentation();

    actions.setSetCollapsed(firstId, true);
    actions.setSetCollapsed(secondId, true);
    await Promise.resolve();

    assert(workspace.collapsedSetIds.includes(firstId) && workspace.collapsedSetIds.includes(secondId),
      "sets did not retain independent collapse state");
    const stored = JSON.parse(localStorage.getItem(storageKeys.workspace));
    assert(stored.collapsedSetIds.includes(firstId) && stored.collapsedSetIds.includes(secondId),
      "collapse state was not saved in the workspace");

    actions.setSetCollapsed(firstId, false);
    assert(!workspace.collapsedSetIds.includes(firstId) && workspace.collapsedSetIds.includes(secondId),
      "expanding one set changed another set");
    actions.removePresentation(secondId);
    assert(!workspace.collapsedSetIds.includes(secondId), "removed set left stale collapse state");
  });

  test("applies semantic document and screen actions by id", async () => {
    await reset();
    const firstSet = deck.presentations[0];
    actions.deckTitle("Action deck");
    actions.presentationTitle(firstSet.id, "Renamed set");
    actions.presentationAttribution(firstSet.id, "Written together");
    actions.slideTitle(firstSet.id, firstSet.slides[0].id, "Opening");
    const presentationId = actions.addPresentation();
    assert(deck.title === "Action deck" && firstSet.title === "Renamed set"
      && firstSet.attribution === "Written together" && firstSet.slides[0].title === "Opening",
    "semantic document actions failed");
    assert(deck.presentations.some(item => item.id === presentationId), "set was not added");
    actions.removePresentation(presentationId);
    assert(!deck.presentations.some(item => item.id === presentationId), "set was not removed");

    const screenId = actions.addScreen();
    actions.renameScreen(screenId, "Lobby");
    actions.screenWidth(screenId, -1);
    actions.previewScreen(screenId);
    const screen = workspace.screens.find(item => item.id === screenId);
    assert(screen.label === "Lobby" && screen.width === 1 && workspace.previewScreenId === screenId, "screen actions failed or dimensions were not clamped");
    actions.removeScreen(screenId);
    assert(!workspace.screens.some(item => item.id === screenId), "screen was not removed");
  });

  test("confirms closed screen removal and preserves cancellation", async () => {
    await reset();
    const originalConfirm = window.confirm;
    const screenId = actions.addScreen();
    await wait();
    const card = document.querySelector(`[data-screen-id="${screenId}"]`);
    const remove = card.querySelector(".screen-settings .danger");
    let prompt = "";
    try {
      window.confirm = message => { prompt = message; return false; };
      remove.click();
      assert(workspace.screens.some(screen => screen.id === screenId) && prompt.includes("cannot be undone"),
        "cancelling closed-screen removal lost the screen or omitted the irreversible warning");
      window.confirm = () => true;
      remove.click();
      assert(!workspace.screens.some(screen => screen.id === screenId),
        "confirming closed-screen removal did not remove the screen");
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("imports atomically and exports only the deck", async () => {
    await reset();
    actions.editing(true);
    await wait();
    const previousTitle = deck.title;
    const input = document.querySelector('input[type="file"]');
    chooseFile(input, "deck.json", JSON.stringify({
      title: "Imported file",
      presentations: [{ title: "One", slides: [{ title: "Notice", content: "Hello" }] }]
    }));
    await wait();
    assert(deck.title === "Imported file" && deck.presentations[0].slides[0].content === "Hello", "file import failed");
    assert(selected() === null, "import unexpectedly cued content");
    actions.undo();
    assert(deck.title === previousTitle && selected() === null, "import Undo did not restore the prior deck in standby");
    actions.redo();
    assert(deck.title === "Imported file", "import Redo did not restore the imported deck");

    const nativeClick = HTMLAnchorElement.prototype.click;
    let download;
    try {
      HTMLAnchorElement.prototype.click = function () { download = this.download; };
      actions.exportDeck();
    } finally {
      HTMLAnchorElement.prototype.click = nativeClick;
    }
    assert(download === "Imported-file.json", "export did not create the expected deck download");

    chooseFile(input, "bad.json", "not json");
    await wait();
    assert(deck.title === "Imported file" && queries.notice("deck").startsWith("Import failed:"), "failed import changed the deck or missed its scoped notice");
  });

  test("lets the newest overlapping file import win", async () => {
    await reset();
    actions.editing(true);
    await wait();
    const input = document.querySelector('input[type="file"]');
    const reads = { first: deferred(), second: deferred() };
    const nativeText = File.prototype.text;
    try {
      File.prototype.text = function () { return reads[this.name.split(".")[0]].promise; };
      chooseFile(input, "first.json", "ignored");
      chooseFile(input, "second.json", "ignored");
      reads.second.resolve(JSON.stringify({ title: "Second", presentations: [] }));
      await wait();
      reads.first.resolve(JSON.stringify({ title: "First", presentations: [] }));
      await wait();
      assert(deck.title === "Second", "an older file result replaced the newest import");
    } finally {
      File.prototype.text = nativeText;
    }
  });

  test("supports native drag and drop for slides and sets", async () => {
    await reset();
    const slideId = deck.presentations[0].slides[0].id;
    const handles = document.querySelectorAll('[aria-label="Move slide"]');
    assert(handles.length && !editing(), "Operate did not expose slide drag handles");
    const target = document.querySelectorAll(".slide-card")[1];
    dragTo(handles[0], target, { clientX: target.getBoundingClientRect().right });
    await wait();
    assert(deck.presentations[0].slides[1].id === slideId, "slide drop did not reorder state");
    actions.undo();
    assert(deck.presentations[0].slides[0].id === slideId, "Undo did not restore slide order");
    actions.redo();
    assert(deck.presentations[0].slides[1].id === slideId, "Redo did not restore slide order");

    actions.addPresentation();
    actions.editing(false);
    await wait();
    const setId = deck.presentations[0].id;
    const setTarget = document.querySelectorAll(".presentation")[1];
    dragTo(document.querySelectorAll('[aria-label="Move set"]')[0], setTarget, { clientY: setTarget.getBoundingClientRect().bottom });
    await wait();
    assert(deck.presentations[1].id === setId, "set drop did not reorder state");
    actions.undo();
    assert(deck.presentations[0].id === setId, "Undo did not restore set order");
    actions.redo();
    assert(deck.presentations[1].id === setId, "Redo did not restore set order");
  });

  test("configures arbitrary screens with independent context banks", async () => {
    const screen = workspace.screens[0];
    actions.screenTextPosition(screen.id, "withoutVideo", "top-left");
    actions.screenTextPosition(screen.id, "withVideo", "bottom-right");
    actions.screenTextRows(screen.id, 20);
    actions.screenWidth(screen.id, 1024);
    actions.screenHeight(screen.id, 768);
    actions.screenVideoMode(screen.id, "off");
    await wait();
    assert(screen.textPositions.withoutVideo === "top-left" && screen.textPositions.withVideo === "bottom-right", "position banks were coupled");
    assert(screen.textRows === 20 && screen.width / screen.height === 4 / 3, "rows or custom resolution failed");
    const box = document.querySelector(`[data-screen-id="${screen.id}"] .canvas`).getBoundingClientRect();
    assert(Math.abs(box.width / box.height - 4 / 3) < .01, "custom preview aspect distorted");
  });

  test("synchronizes a generic output with blank and live states", async () => {
    const screen = workspace.screens[0];
    let payload;
    const target = { closed: false, acceptViewState: value => payload = value };
    window.presentlyConnect(target, screen.id);
    actions.clearSelection();
    await wait();
    assert(payload.label === screen.label && payload.composition.text === "", "standby output did not synchronize");
    const slide = deck.presentations[0].slides[0];
    actions.select(deck.presentations[0].id, slide.id);
    await wait();
    assert(payload.composition.text === slide.content && payload.composition.width === screen.width, "live output did not synchronize");
    window.presentlyDisconnect(target, screen.id);
  });

  test("shows, refreshes, selects, and safely replaces live sources", async () => {
    const native = navigator.mediaDevices;
    const makeStream = () => {
      const listeners = {};
      const track = { stopped: false, stop() { this.stopped = true; }, addEventListener(type, listener) { listeners[type] = listener; } };
      const stream = new MediaStream();
      stream.getTracks = () => [track];
      return { stream, track, listeners };
    };
    const probes = [makeStream(), makeStream()];
    const cameras = [
      { "camera-1": makeStream(), "camera-2": makeStream() },
      { "camera-1": makeStream(), "camera-2": makeStream() }
    ];
    const display = makeStream();
    const slow = makeStream();
    let generation = -1;
    try {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
        getUserMedia: async constraints => {
          if (constraints.video === true) return probes[++generation].stream;
          return cameras[generation][constraints.video.deviceId.exact].stream;
        },
        enumerateDevices: async () => [
          { kind: "videoinput", deviceId: "camera-1", label: "Wide camera" },
          { kind: "videoinput", deviceId: "camera-2", label: "Room camera" }
        ],
        getDisplayMedia: async () => display.stream
      } });
      await media.refreshCameras();
      await wait();
      assert(media.cameras().length === 2 && document.querySelectorAll(".source-card").length === 2, "camera cards were not all visible");
      const hideBox = document.querySelector(".source-hide").getBoundingClientRect();
      assert(hideBox.width >= 23.9 && hideBox.height >= 23.9,
        "source hide action was smaller than the compact control target minimum");
      assert(probes[0].track.stopped, "permission probe leaked");
      document.querySelector(".source-select").click();
      assert(media.selected()?.stream === cameras[0]["camera-1"].stream, "camera card did not select its live stream");
      assert(document.querySelector(".source-select").getAttribute("aria-label") === "Stop using Wide camera",
        "selected source did not expose its stop action");
      document.querySelector(".source-select").click();
      assert(media.selected() === null && !cameras[0]["camera-1"].track.stopped, "camera toggle stopped the preview inventory");
      media.toggleSource(media.cameras()[0].key);
      document.querySelectorAll(".source-hide")[1].click();
      await wait();
      assert(media.cameras().length === 1 && cameras[0]["camera-2"].track.stopped, "hiding a source did not remove and stop it");

      await media.refreshCameras();
      assert(media.selected()?.stream === cameras[1]["camera-1"].stream, "refresh did not preserve selection by device id");
      assert(cameras[0]["camera-1"].track.stopped && cameras[0]["camera-2"].track.stopped, "refresh leaked the old inventory");
      const screen = workspace.screens[0];
      actions.screenVideoMode(screen.id, "cover");
      actions.clearSelection();
      await wait();
      const output = document.querySelector(`[data-screen-id="${screen.id}"]`);
      assert(output.querySelector("video")?.srcObject === cameras[1]["camera-1"].stream && !output.querySelector(".canvas-text").innerText, "blanking words stopped or obscured live video");
      await media.shareDisplay();
      assert(media.selected()?.stream === display.stream && !cameras[1]["camera-1"].track.stopped, "display selection destroyed the camera inventory");
      navigator.mediaDevices.getDisplayMedia = async () => { throw new Error("cancelled"); };
      await media.shareDisplay();
      assert(media.selected()?.stream === display.stream, "cancelled display sharing interrupted the live source");
      display.listeners.ended();
      await wait();
      assert(media.selected() === null, "ended source remained active");

      let releaseSlow;
      navigator.mediaDevices.getDisplayMedia = () => new Promise(resolve => releaseSlow = () => resolve(slow.stream));
      const slowRequest = media.shareDisplay();
      media.toggleSource(media.cameras()[1].key);
      releaseSlow();
      await slowRequest;
      assert(media.selected()?.stream === cameras[1]["camera-2"].stream && slow.track.stopped, "a stale display replaced the newer source or leaked tracks");
    } finally {
      media.clearSelection();
      actions.screenVideoMode(workspace.screens[0].id, "off");
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: native });
    }
  });

  test("runs on the secure origin required by live media", () => {
    assert(isSecureContext && location.protocol === "https:", "media tests were not served from HTTPS");
  });

  let failures = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures++;
      console.error(`✗ ${name}: ${error.message}`);
    }
  }
  console.log(`${tests.length - failures}/${tests.length} built-in tests passed`);
  return failures;
}

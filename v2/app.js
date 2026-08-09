import { For, Show, batch, createEffect, createSignal, onCleanup } from "solid-js";
import html from "solid-js/html";
import { render } from "solid-js/web";
import { OutputCanvas, Video } from "./canvas.js";
import { createController, hydrateController } from "./controller.js";
import { createMediaController } from "./media.js";
import { createOutputController, createViewerConnection } from "./outputs.js";
import {
  DEFAULT_SCREEN_SIZE,
  POSITIONS,
  activePositionBank,
  adjacentSlide,
  createScreen,
  parseOutline,
  resolveScreenComposition,
  resolveThumbnailComposition,
  sectionSlide,
  tagColor
} from "./model.js";

const rowLabel = rows => `${rows} row${rows === 1 ? "" : "s"}`;

export function createBrowserEnvironment(global = window) {
  return {
    newId: () => global.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    defer: callback => global.queueMicrotask(callback),
    storage: {
      get: key => global.localStorage.getItem(key),
      set: (key, value) => global.localStorage.setItem(key, value),
      remove: key => global.localStorage.removeItem(key)
    },
    mediaDevices: () => global.navigator.mediaDevices,
    confirm: message => global.confirm(message),
    download({ filename, text }) {
      const url = global.URL.createObjectURL(new global.Blob([text], { type: "application/json" }));
      const anchor = Object.assign(global.document.createElement("a"), { href: url, download: filename });
      anchor.click();
      global.setTimeout(() => global.URL.revokeObjectURL(url), 0);
    },
    outputHost: {
      open: (...args) => global.open(...args),
      isClosed: target => Boolean(target?.closed),
      focus: target => target.focus(),
      close: target => target.close(),
      send: (target, payload) => {
        try {
          target.acceptViewState(payload);
          return true;
        } catch {
          return false;
        }
      },
      installControllerBridge(connect, disconnect) {
        global.presentlyConnect = connect;
        global.presentlyDisconnect = disconnect;
        return () => {
          if (global.presentlyConnect === connect) global.presentlyConnect = undefined;
          if (global.presentlyDisconnect === disconnect) global.presentlyDisconnect = undefined;
        };
      },
      installViewerReceiver(accept) {
        global.acceptViewState = accept;
        return () => {
          if (global.acceptViewState === accept) global.acceptViewState = undefined;
        };
      },
      connectToOpener(id) {
        const opener = global.opener;
        if (!opener?.presentlyConnect?.(global, id)) return null;
        return () => opener.presentlyDisconnect?.(global, id);
      },
      installPageLifecycle(hide, show) {
        global.addEventListener("pagehide", hide);
        global.addEventListener("pageshow", show);
        return () => {
          global.removeEventListener("pagehide", hide);
          global.removeEventListener("pageshow", show);
        };
      }
    }
  };
}

function Viewer(environment, bootstrap, capture) {
  const fallbackScreen = {
    ...createScreen(environment.newId, "Output", DEFAULT_SCREEN_SIZE),
    id: "output"
  };
  const connection = createViewerConnection(environment.outputHost, bootstrap.screenId, {
    screenId: bootstrap.screenId,
    label: fallbackScreen.label,
    composition: resolveScreenComposition(fallbackScreen, null),
    source: null
  }, environment.defer);
  capture(connection);
  createEffect(() => document.title = `Presently · ${connection.view().label}`);

  return html`
    <main class="viewer">
      <${OutputCanvas} composition=${() => connection.view().composition} source=${() => connection.view().source} />
    </main>
  `;
}

function App(environment, bootstrap, capture) {
  if (bootstrap.testMode) {
    try {
      environment.storage.remove(bootstrap.storageKeys.deck);
      environment.storage.remove(bootstrap.storageKeys.workspace);
    } catch {
      // A denied test namespace must not prevent the app from mounting.
    }
  }

  const hydrated = hydrateController({
    storage: environment.storage,
    storageKeys: bootstrap.storageKeys,
    newId: environment.newId,
    includeLegacy: bootstrap.includeLegacy
  });
  const controller = createController({
    initialDeck: hydrated.deck,
    initialWorkspace: hydrated.workspace,
    initialNotice: hydrated.notice,
    storage: environment.storage,
    storageKeys: bootstrap.storageKeys,
    newId: environment.newId
  });
  const media = createMediaController(environment);
  const outputs = createOutputController(environment.outputHost);
  const deck = controller.deck.state;
  const workspace = controller.workspace.state;
  const selected = controller.cue.selection;
  const liveEntry = controller.cue.entry;
  const referenceScreen = controller.workspace.referenceScreen;
  const slideLabels = controller.deck.labels;
  const history = controller.history;
  const [editing, setEditing] = createSignal(false);
  const [focusedSlideId, setFocusedSlideId] = createSignal(null);
  const [dragged, setDragged] = createSignal(null);
  const [dropMarker, setDropMarker] = createSignal(null);
  const sources = media.sources;
  const selectedSourceKey = media.selectedKey;
  const source = media.selected;
  const openScreenIds = outputs.openIds;
  let focusRequest = 0;
  let disposed = false;

  const beginDeckChange = history.begin;
  const setWordsEditing = value => {
    if (!value) history.commit();
    setEditing(Boolean(value));
    if (!value) setFocusedSlideId(null);
  };

  const focusSlide = id => {
    const request = ++focusRequest;
    setFocusedSlideId(null);
    environment.defer(() => {
      if (!disposed && request === focusRequest) setFocusedSlideId(id);
    });
  };
  const clearFocusAfter = change => {
    const changed = change();
    if (changed) setFocusedSlideId(null);
    return changed;
  };

  const actions = {
    editing: setWordsEditing,
    deckTitle: controller.deck.setTitle,
    select: controller.cue.select,
    clearSelection: controller.cue.clear,
    presentationTitle: controller.deck.setPresentationTitle,
    presentationAttribution: controller.deck.setPresentationAttribution,
    slideTitle: controller.deck.setSlideTitle,
    slideContent: controller.deck.setSlideContent,
    addPresentation: () => {
      const created = controller.deck.addPresentation();
      setWordsEditing(true);
      focusSlide(created.slideId);
      return created.presentationId;
    },
    removePresentation: id => {
      const focused = deck.presentations.some(presentation =>
        presentation.id === id && presentation.slides.some(slide => slide.id === focusedSlideId())
      );
      const changed = controller.deck.removePresentation(id);
      if (changed && focused) setFocusedSlideId(null);
      return changed;
    },
    movePresentation: controller.deck.movePresentation,
    addSlide: presentationId => {
      let id;
      batch(() => {
        controller.workspace.setSetCollapsed(presentationId, false);
        id = controller.deck.addSlide(presentationId);
        if (id) {
          setWordsEditing(true);
          focusSlide(id);
        }
      });
      return id;
    },
    removeSlide: (presentationId, slideId) => {
      const changed = controller.deck.removeSlide(presentationId, slideId);
      if (changed && focusedSlideId() === slideId) setFocusedSlideId(null);
      return changed;
    },
    moveSlide: controller.deck.moveSlide,
    replaceSlideWithSections: (presentationId, slideId, parsed) => {
      const ids = controller.deck.splitSlide(presentationId, slideId, parsed);
      if (ids[0]) focusSlide(ids[0]);
      return ids;
    },
    replaceDeck: input => clearFocusAfter(() => controller.deck.replace(input)),
    resetDeck: () => clearFocusAfter(controller.deck.reset),
    exportDeck: () => environment.download(controller.deck.exportPayload()),
    setSetCollapsed: controller.workspace.setSetCollapsed,
    addScreen: controller.workspace.addScreen,
    removeScreen: id => {
      outputs.retire(id);
      return controller.workspace.removeScreen(id);
    },
    renameScreen: controller.workspace.renameScreen,
    screenWidth: controller.workspace.setScreenWidth,
    screenHeight: controller.workspace.setScreenHeight,
    screenVideoMode: controller.workspace.setVideoMode,
    screenTextPosition: controller.workspace.setTextPosition,
    screenTextRows: controller.workspace.setTextRows,
    slideColumns: controller.workspace.setSlideColumns,
    previewScreen: controller.workspace.setPreviewScreen,
    undo: () => clearFocusAfter(history.undo),
    redo: () => clearFocusAfter(history.redo),
  };

  const canDrop = target => {
    const sourceItem = dragged();
    return sourceItem?.type === target.type
      && (target.type === "presentation" || sourceItem.presentationId === target.presentationId);
  };
  const clearDrag = () => {
    setDragged(null);
    setDropMarker(null);
  };
  const beginDrag = (event, item) => {
    setDragged(item);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    const card = event.currentTarget.closest(".slide-card, .presentation");
    if (card) event.dataTransfer.setDragImage(card, 12, 12);
  };
  const allowDrop = (event, target) => {
    if (!canDrop(target)) return;
    event.preventDefault();
    const rectangle = event.currentTarget.getBoundingClientRect();
    const coordinate = target.type === "presentation" ? event.clientY : event.clientX;
    const middle = target.type === "presentation"
      ? rectangle.top + rectangle.height / 2
      : rectangle.left + rectangle.width / 2;
    setDropMarker({ id: target.id, side: coordinate < middle ? "before" : "after" });
  };
  const drop = (event, target) => {
    const sourceItem = dragged();
    const marker = dropMarker();
    if (sourceItem && marker && canDrop(target)) {
      event.preventDefault();
      if (target.type === "presentation") actions.movePresentation(sourceItem.id, target.id, marker.side);
      else actions.moveSlide(target.presentationId, sourceItem.id, target.id, marker.side);
    }
    clearDrag();
  };

  const publishOutputs = () => outputs.publish(workspace.screens.map(screen => ({
    screenId: screen.id,
    label: screen.label,
    composition: structuredClone(resolveScreenComposition(screen, liveEntry())),
    source: screen.videoMode === "off" ? null : source()
  })));
  createEffect(publishOutputs);
  addEventListener("pageshow", publishOutputs);
  if (!bootstrap.testMode) media.start();
  onCleanup(() => {
    disposed = true;
    focusRequest++;
    removeEventListener("pageshow", publishOutputs);
  });

  function Notice(props) {
    return html`<${Show} when=${() => props.text}><p class="notice" role="status">${() => props.text}</p><//>`;
  }

  function MoveMark() {
    return html`
      <svg class="move-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M8 1v14M1 8h14M8 1 5.5 3.5M8 1l2.5 2.5M15 8l-2.5-2.5M15 8l-2.5 2.5M8 15l-2.5-2.5M8 15l2.5-2.5M1 8l2.5-2.5M1 8l2.5 2.5"></path>
      </svg>
    `;
  }

  function EditModeSwitch(props) {
    return html`
      <label class="edit-switch">
        <span>Edit mode</span>
        <input data-test=${props.primary ? "edit-mode" : undefined}
          type="checkbox" role="switch" checked=${editing}
          onChange=${event => actions.editing(event.currentTarget.checked)}>
        <span class="switch-track" aria-hidden="true"></span>
      </label>
    `;
  }

  function SlideCard(props) {
    const [overflow, setOverflow] = createSignal(false);
    const isSelected = () => selected()?.slideId === props.slide.id;
    const isFocused = () => focusedSlideId() === props.slide.id;
    const composition = () => resolveThumbnailComposition(
      referenceScreen(),
      props.presentation,
      props.slide,
      props.index
    );
    const dropState = () => dropMarker()?.id === props.slide.id ? dropMarker()?.side : "";

    const updateText = (value, meta) => {
      actions.slideContent(props.presentation.id, props.slide.id, value);
      if (!meta.pasted) return;
      const parsed = parseOutline(value);
      if (parsed.shouldSplit && environment.confirm("Split the pasted sections into slides?")) {
        history.commit();
        actions.replaceSlideWithSections(props.presentation.id, props.slide.id, parsed);
      }
    };

    const toggleCue = () => isSelected()
      ? actions.clearSelection()
      : actions.select(props.presentation.id, props.slide.id);
    const click = event => {
      if (editing() || event.detail !== 1) return;
      toggleCue();
    };
    const toggleEditing = () => {
      const next = !editing();
      actions.select(props.presentation.id, props.slide.id);
      actions.editing(next);
      if (next) focusSlide(props.slide.id);
    };
    const keydown = event => {
      if (editing() || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      toggleCue();
    };

    return html`
      <article class="slide-card"
        classList=${() => ({
          selected: isSelected(),
          focused: isFocused(),
          "drop-before": dropState() === "before",
          "drop-after": dropState() === "after"
        })}
        data-slide-id=${props.slide.id}
        onDragOver=${event => allowDrop(event, { type: "slide", id: props.slide.id, presentationId: props.presentation.id })}
        onDrop=${event => drop(event, { type: "slide", id: props.slide.id, presentationId: props.presentation.id })}>
        <div class="slide-preview"
          role=${() => editing() ? undefined : "button"}
          tabindex=${() => editing() ? undefined : 0}
          aria-current=${isSelected}
          aria-label=${() => `${isSelected() ? "Clear" : "Cue"} slide ${props.index + 1}: ${props.slide.title || "Unlabeled"}`}
          onClick=${click}
          onDblClick=${toggleEditing}
          onKeyDown=${keydown}>
          <${OutputCanvas}
            composition=${composition}
            editable=${editing}
            editorLabel=${() => `Slide ${props.index + 1} text`}
            focusRequested=${isFocused}
            measureOverflow=${() => isSelected() || isFocused()}
            onOverflow=${value => setOverflow(value)}
            onTextInput=${updateText}
            onTextFocus=${event => {
              beginDeckChange("Edit slide");
              setFocusedSlideId(props.slide.id);
            }}
            onTextBlur=${event => {
              history.commit();
              if (isFocused()) setFocusedSlideId(null);
            }} />
        </div>
        <div class="slide-caption" style=${() => ({ background: tagColor(props.slide.title) })}>
          <span class="slide-state" hidden=${() => !isSelected()}>LIVE</span>
          <input aria-label="Slide label"
            list="slide-labels"
            value=${() => props.slide.title}
            onFocus=${event => beginDeckChange("Edit slide label")}
            onBlur=${event => history.commit()}
            onInput=${event => actions.slideTitle(props.presentation.id, props.slide.id, event.currentTarget.value)}>
        </div>
        <${Show} when=${() => overflow() && (isSelected() || isFocused())}>
          <span class="overflow-warning">Text exceeds safe area</span>
        <//>
        <span class="slide-tools">
          <button class="drag-handle quiet-action" draggable="true" aria-label="Move slide"
            onDragStart=${event => beginDrag(event, { type: "slide", id: props.slide.id, presentationId: props.presentation.id })}
            onDragEnd=${clearDrag}><${MoveMark} /></button>
          <button class="danger quiet-action" aria-label="Remove slide"
            onClick=${() => actions.removeSlide(props.presentation.id, props.slide.id)}>×</button>
        </span>
      </article>
    `;
  }

  function Presentation(props) {
    const collapsed = () => controller.workspace.isSetCollapsed(props.presentation.id);
    const collapsedLiveLabel = () => {
      if (!collapsed()) return "";
      const entry = liveEntry();
      if (entry?.presentation.id !== props.presentation.id) return "";
      const index = props.presentation.slides.findIndex(slide => slide.id === entry.slide.id);
      return index < 0 ? "" : `LIVE · ${String(index + 1).padStart(2, "0")}`;
    };
    const dropState = () => dropMarker()?.id === props.presentation.id ? dropMarker()?.side : "";
    const setCollapsed = value => actions.setSetCollapsed(props.presentation.id, value);
    const toggleCollapsed = event => {
      if (event?.target.closest?.("input, button, textarea, select, details, summary")) return;
      setCollapsed(!collapsed());
    };
    const remove = () => {
      if (environment.confirm(`Remove “${props.presentation.title}” and all of its slides?`)) {
        actions.removePresentation(props.presentation.id);
      }
    };

    return html`
      <section class="presentation"
        classList=${() => ({
          "drop-before": dropState() === "before",
          "drop-after": dropState() === "after"
        })}
        onDragOver=${event => allowDrop(event, { type: "presentation", id: props.presentation.id })}
        onDrop=${event => drop(event, { type: "presentation", id: props.presentation.id })}>
        <header class="presentation-head" onClick=${toggleCollapsed}>
          <div class="presentation-name">
            <button class="collapse-toggle quiet-action" aria-label=${() => `${collapsed() ? "Expand" : "Collapse"} ${props.presentation.title}`}
              aria-expanded=${() => !collapsed()}
              onClick=${event => { event.stopPropagation(); setCollapsed(!collapsed()); }}>${() => collapsed() ? "▸" : "▾"}</button>
            <input class="presentation-title" aria-label="Set title"
              value=${() => props.presentation.title}
              onFocus=${event => beginDeckChange("Edit set title")}
              onBlur=${event => history.commit()}
              onInput=${event => actions.presentationTitle(props.presentation.id, event.currentTarget.value)}>
            <span class="set-live-cue" hidden=${() => !collapsedLiveLabel()}>
              ${collapsedLiveLabel}
            </span>
          </div>
          <div class="presentation-actions">
            <span class="set-tools">
              <button class="set-move drag-handle quiet-action" draggable="true" aria-label="Move set"
                onDragStart=${event => beginDrag(event, { type: "presentation", id: props.presentation.id })}
                onDragEnd=${clearDrag}>Move</button>
              <button class="set-remove danger quiet-action" onClick=${remove}>Remove</button>
            </span>
            <button class="set-add quiet-action" onClick=${() => actions.addSlide(props.presentation.id)}>Add slide</button>
            <${EditModeSwitch} />
          </div>
        </header>
        <${Show} when=${() => !collapsed()}>
          <div class="presentation-content">
            <div class="slide-grid">
              <${For} each=${() => props.presentation.slides}>
                ${(slide, index) => html`
                  <${SlideCard}
                    slide=${slide}
                    index=${index}
                    presentation=${() => props.presentation} />
                `}
              <//>
            </div>
            <textarea class="set-attribution" aria-label="Set attribution" placeholder="Enter attribution"
              value=${() => props.presentation.attribution}
              onFocus=${event => beginDeckChange("Edit attribution")}
              onBlur=${event => history.commit()}
              onInput=${event => actions.presentationAttribution(props.presentation.id, event.currentTarget.value)}></textarea>
          </div>
        <//>
      </section>
    `;
  }

  function DeckPanel() {
    let fileInput;
    let importRequest = 0;
    const cueLabel = () => {
      const entry = liveEntry();
      return entry
        ? `${entry.presentation.title} · ${entry.slide.title || `Slide ${entry.slideIndex + 1}`}`
        : "Standby";
    };
    const importDeck = async event => {
      const request = ++importRequest;
      const input = event.currentTarget;
      const file = input.files?.[0];
      if (!file) return;
      try {
        const value = JSON.parse(await file.text());
        if (!disposed && request === importRequest) actions.replaceDeck(value);
      } catch (error) {
        if (!disposed && request === importRequest) controller.deck.report(`Import failed: ${error.message}`);
      }
      if (request === importRequest) input.value = "";
    };
    const reset = () => {
      if (environment.confirm("Restore the tutorial deck? Your current deck will be replaced.")) actions.resetDeck();
    };
    onCleanup(() => importRequest++);

    return html`
      <section class="deck-panel" aria-label="Deck">
        <header class="toolbar">
          <input class="deck-title" aria-label="Deck title"
            value=${() => deck.title}
            onFocus=${event => beginDeckChange("Edit deck title")}
            onBlur=${event => history.commit()}
            onInput=${event => actions.deckTitle(event.currentTarget.value)}>
          <div class="toolbar-actions">
            <button class="quiet-action" data-test="undo" disabled=${() => !history.canUndo()}
              title=${() => history.undoLabel() ? `Undo ${history.undoLabel()} (Ctrl+Z)` : "Nothing to undo"}
              aria-keyshortcuts="Control+Z Meta+Z"
              onClick=${event => actions.undo()}>Undo</button>
            <button class="quiet-action" data-test="redo" disabled=${() => !history.canRedo()}
              title=${() => history.redoLabel() ? `Redo ${history.redoLabel()} (Ctrl+Shift+Z)` : "Nothing to redo"}
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
              onClick=${event => actions.redo()}>Redo</button>
            <button class="quiet-action" data-test="add-set" onClick=${() => actions.addPresentation()}>Add set</button>
            <button class="quiet-action" onClick=${() => fileInput.click()}>Import</button>
            <button class="quiet-action" onClick=${event => actions.exportDeck(event)}>Export</button>
            <button class="danger quiet-action" onClick=${reset}>Reset</button>
            <input ref=${node => fileInput = node} class="file-input" type="file"
              accept="application/json" onChange=${importDeck}>
            <${EditModeSwitch} primary=${true} />
          </div>
        </header>
        <span class="sr-only" role="status">${() => cueLabel()}</span>
        <${Notice} text=${controller.deck.status} />
        <div class="deck-body" style=${() => ({ "--slide-columns": workspace.slideColumns })}>
          <${For} each=${() => deck.presentations}>
            ${presentation => html`<${Presentation} presentation=${presentation} />`}
          <//>
          <${Show} when=${() => !deck.presentations.length}>
            <button class="empty-add" onClick=${() => actions.addPresentation()}>Add set</button>
          <//>
        </div>
        <footer class="deck-footer">
          <div class="deck-size-controls">
            <label class="compact-view-control">
              <span>Screen size</span>
              <select aria-label="Thumbnail screen size" value=${() => workspace.previewScreenId ?? ""}
                disabled=${() => !workspace.screens.length}
                onChange=${event => actions.previewScreen(event.currentTarget.value)}>
                <${For} each=${() => workspace.screens}>
                  ${screen => html`<option value=${screen.id}>${() => screen.label}</option>`}
                <//>
              </select>
            </label>
            <label class="compact-view-control">
              <span>Slide size</span>
              <input aria-label="Slides per row" title=${() => `${workspace.slideColumns} slides per row`}
                type="range" min="2" max="10" step="1"
                value=${() => workspace.slideColumns}
                aria-valuetext=${() => `${workspace.slideColumns} columns`}
                onInput=${event => actions.slideColumns(event.currentTarget.value)}>
            </label>
          </div>
        </footer>
        <datalist id="slide-labels">
          <${For} each=${slideLabels}>${label => html`<option value=${label}></option>`}<//>
        </datalist>
      </section>
    `;
  }

  const POSITION_GLYPHS = ["↖", "↑", "↗", "←", "·", "→", "↙", "↓", "↘"];

  function CompositionControls(props) {
    const bank = () => activePositionBank(props.screen);
    const position = () => props.screen.textPositions[bank()];
    const context = () => bank() === "withVideo" ? "Video layout" : "Words-only layout";

    return html`
      <div class="composition-controls">
        <fieldset class="position-control">
          <legend>Text position <span>${context}</span></legend>
          <div class="position-grid">
            <${For} each=${POSITIONS}>
              ${(value, index) => html`
                <label title=${() => value.replace("-", " ")}>
                  <input type="radio"
                    name=${() => `position-${props.screen.id}-${bank()}`}
                    value=${value}
                    checked=${() => position() === value}
                    aria-label=${() => value.replace("-", " ")}
                    onChange=${event => {
                      if (event.currentTarget.checked) props.onPosition(value, bank());
                    }}>
                  <span aria-hidden="true">${POSITION_GLYPHS[index()]}</span>
                </label>
              `}
            <//>
          </div>
        </fieldset>
        <label class="rows-control">
          <span>Text rows <output>${() => rowLabel(props.screen.textRows)}</output></span>
          <input type="range" min="1" max="20" step="1"
            value=${() => props.screen.textRows}
            aria-valuetext=${() => rowLabel(props.screen.textRows)}
            onInput=${event => props.onRows(Number(event.currentTarget.value))}>
          <small><span>1</span><span>20</span></small>
        </label>
      </div>
    `;
  }

  function OutputCard(props) {
    const [overflow, setOverflow] = createSignal(false);
    const composition = () => resolveScreenComposition(props.screen, liveEntry());
    const screenSource = () => props.screen.videoMode === "off" ? null : source();
    const isOpen = () => openScreenIds().includes(props.screen.id);
    const remove = () => {
      if (!environment.confirm(`Remove the ${props.screen.label} screen? This cannot be undone.`)) return;
      actions.removeScreen(props.screen.id);
    };

    return html`
      <section class="output-card" data-screen-id=${props.screen.id}>
        <header class="screen-head">
          <input class="screen-label" aria-label="Screen label"
            value=${() => props.screen.label}
            onInput=${event => actions.renameScreen(props.screen.id, event.currentTarget.value)}>
          <button class="output-open quiet-action" data-test="open-output"
            classList=${() => ({ open: isOpen() })}
            aria-label=${() => isOpen() ? `${props.screen.label} output open` : `Open ${props.screen.label} output`}
            onClick=${() => outputs.open(props.screen)}>${() => isOpen() ? "Open ✓" : "Open"}</button>
          <label class="video-control">
            <span>Video</span>
            <select aria-label="Video mode" value=${() => props.screen.videoMode}
              onChange=${event => actions.screenVideoMode(props.screen.id, event.currentTarget.value)}>
              <option value="off">Off</option>
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
            </select>
          </label>
          <details class="screen-menu" name="screen-settings">
            <summary class="quiet-action"
              aria-label=${() => `${props.screen.label} settings${overflow() ? ", text overflow" : ""}`}>
              <span>More</span>
              <${Show} when=${overflow}>
                <span class="advanced-warning" aria-hidden="true">!</span>
                <span class="sr-only">Text overflow</span>
              <//>
            </summary>
            <div class="menu-panel screen-settings-panel">
              <${CompositionControls}
                screen=${() => props.screen}
                onPosition=${(position, bank) => actions.screenTextPosition(props.screen.id, bank, position)}
                onRows=${rows => actions.screenTextRows(props.screen.id, rows)} />
              <div class="screen-settings">
                <label>Width <input aria-label="Screen width" type="number" min="1" value=${() => props.screen.width}
                  onChange=${event => actions.screenWidth(props.screen.id, event.currentTarget.value)}></label>
                <label>Height <input aria-label="Screen height" type="number" min="1" value=${() => props.screen.height}
                  onChange=${event => actions.screenHeight(props.screen.id, event.currentTarget.value)}></label>
                <button class="danger quiet-action" onClick=${remove}>Remove screen</button>
              </div>
            </div>
          </details>
        </header>
        <${OutputCanvas}
          composition=${composition}
          source=${screenSource}
          measureOverflow=${() => true}
          onOverflow=${value => setOverflow(value)} />
        <${Notice} text=${() => outputs.statusFor(props.screen.id)} />
      </section>
    `;
  }

  function SourcePanel() {
    return html`
      <section class="sources" classList=${() => ({ "has-sources": sources.length > 0 })} aria-label="Video sources">
        <header class="panel-head source-head">
          <h2>Sources</h2>
          <span class="source-status">${() => source()?.label ?? "None selected"}</span>
          <div class="source-actions">
            <button class="quiet-action" onClick=${media.shareDisplay}>Share display</button>
            <button class="quiet-action" data-test="find-cameras" onClick=${media.refreshCameras}>Refresh</button>
          </div>
        </header>
        <${Notice} text=${media.status} />
        <div class="source-list">
          <${For} each=${sources} fallback=${html`<p class="source-empty">No cameras visible. Refresh to try again.</p>`}>
            ${item => {
              const active = () => selectedSourceKey() === item.key;
              return html`
                <article class="source-card" classList=${() => ({ active: active() })}>
                  <button class="source-select"
                    aria-pressed=${active}
                    aria-label=${() => `${active() ? "Stop using" : "Use"} ${item.label}`}
                    onClick=${() => media.toggleSource(item.key)}>
                    <span class="source-frame"><${Video} source=${() => item} /></span>
                    <span>${() => item.label}</span>
                  </button>
                  <button class="source-hide" aria-label=${() => `Hide ${item.label}`}
                    onClick=${() => media.hideSource(item.key)}>×</button>
                </article>
              `;
            }}
          <//>
        </div>
      </section>
    `;
  }

  const onKey = event => {
    const textControl = event.target.closest?.("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']");
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const undoKey = key === "z" && !event.shiftKey;
    const redoKey = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.metaKey);
    if (modifier && !event.altKey && !textControl && (undoKey || redoKey)) {
      event.preventDefault();
      if (undoKey) actions.undo();
      else actions.redo();
      return;
    }
    if (event.key === "Escape" && dragged()) {
      clearDrag();
      return;
    }
    if (event.target.closest?.("input, textarea, select, button, [contenteditable='true'], [contenteditable='plaintext-only']")) return;
    let entry;
    if (event.key === "ArrowRight") entry = adjacentSlide(deck, selected(), 1);
    if (event.key === "ArrowLeft") entry = adjacentSlide(deck, selected(), -1);
    if (event.key === "ArrowDown") entry = sectionSlide(deck, selected(), 1);
    if (event.key === "ArrowUp") entry = sectionSlide(deck, selected(), -1);
    if (event.key === "Escape") {
      controller.cue.clear();
      return;
    }
    if (!entry) return;
    event.preventDefault();
    controller.cue.selectEntry(entry);
    const requestedId = entry.slide.id;
    environment.defer(() => {
      if (!disposed && selected()?.slideId === requestedId) {
        document.querySelector(".slide-card.selected")?.scrollIntoView({ block: "nearest" });
      }
    });
  };
  addEventListener("keydown", onKey);
  onCleanup(() => removeEventListener("keydown", onKey));

  const application = {
    commands: actions,
    queries: {
      deck: () => deck,
      workspace: () => workspace,
      selection: selected,
      editing,
      focusedSlideId,
      notice(scope, id) {
        if (scope === "deck") return controller.deck.status();
        if (scope === "source") return media.status();
        return outputs.statusFor(id);
      }
    },
    fixtures: { controller, media, outputs, storageKeys: bootstrap.storageKeys }
  };
  capture(application);

  return html`
    <div class="shell">
      <main class="console">
        <${DeckPanel} />
        <${SourcePanel} />
      </main>
      <aside class="outputs" aria-label="Screens">
        <header class="output-head">
          <h2>Screens</h2>
          <button class="quiet-action" onClick=${() => actions.addScreen()}>Add screen</button>
        </header>
        <${Notice} text=${controller.workspace.status} />
        <div class="output-grid">
          <${For} each=${() => workspace.screens}>
            ${screen => html`<${OutputCard} screen=${screen} />`}
          <//>
          <${Show} when=${() => !workspace.screens.length}>
            <button class="empty-add" onClick=${() => actions.addScreen()}>Add screen</button>
          <//>
        </div>
      </aside>
    </div>
  `;
}

export function mount(root, environment, bootstrap) {
  let app;
  const capture = value => app = value;
  const dispose = render(
    () => bootstrap.screenId
      ? Viewer(environment, bootstrap, capture)
      : App(environment, bootstrap, capture),
    root
  );
  return { app, dispose };
}

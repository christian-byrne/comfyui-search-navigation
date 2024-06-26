import { $el, ComfyUI } from "../../scripts/ui.js";
import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";
import { ComfyDialog } from "../../scripts/ui/dialog.js";

const SHOW_ON_LOAD = false;
// Based on https://github.com/comfyanonymous/ComfyUI/blob/master/web/scripts/ui/settings.js
export class SearchNavigation extends ComfyDialog {
  constructor(app) {
    super();
    this.app = app;
    this.config = {
      NAV_WIDTH: 50,
      OPEN_SEARCH_HOTKEY: "shift+F",
      UNDO_HOTKEY: "ArrowLeft",
      REDO_HOTKEY: "ArrowRight",
      UNDOREDO_NAVIGATION_WHEN_CLOSED: false,
      SHOW_NODE_IDS: true,
      FOCUS_SEARCH_INPUT_HOTKEY: "shift+?",
      ALLOW_EMPTY_SEARCH: false,
    };
    this.selectedResultIndex = 0;
    this.currentResults = [];
    this.curOffset = null;
    this.settingsOpen = false;
    this.undoStack = [];
    this.redoStack = [];
    this.visible = false;
    this.undoRedoListenerRef = null;
    this.element = $el(
      "dialog",
      {
        id: "comfy-search-navigation",
        parent: document.body,
        onkeydown: (e) => {
          if (e.key === "Enter") {
            this.enterHandler();
          } else if (e.key === "Escape") {
            this.show();
          } else if (e.key === "ArrowDown") {
            this.incrementSelectionIndex(1);
          } else if (e.key === "ArrowUp") {
            this.incrementSelectionIndex(-1);
          }
        },
        style: {
          position: "fixed",
          top: "0",
          left: "0",
          transform: "translateX(-50%) translateY(-100%)",
          width: `${this.config.NAV_WIDTH}vw`,
          // Default background color with increased elevation.
          backgroundColor: "rgba(53, 53, 53, .48)",
          boxShadow:
            "0px 2px 4px -1px rgba(0,0,0,0.2), 0px 4px 5px 0px rgba(0,0,0,0.14), 0px 1px 10px 0px rgba(0,0,0,0.12)",
          borderRadius: "0 0 4px 4px",
          border: "none",
          color: "#fff",
          zIndex: 1000,
          fontSize: "30px",
          padding: ".8rem",
          transition: "transform 0.3s ease, opacity 0.3 ease", // Slide in/out transition.
        },
      },
      [
        $el("table.comfy-modal-content.comfy-table", [
          $el("caption", { textContent: "Search Navigation" }, [
            $el("button.comfy-btn", {
              type: "button",
              style: {},
              textContent: "\u00d7",
              onclick: () => {
                this.show();
              },
            }),
            $el("button.comfy-btn", {
              type: "button",
              style: {
                transform: "translateX(-2rem)",
              },
              textContent: "\u2699",
              onclick: () => {
                this.toggleSettings();
              },
            }),
          ]),
          $el("input", {
            type: "text",
            id: "searchInput",
            placeholder: "Search Nodes...",
            style: {
              marginBottom: ".5rem",
              marginTop: ".1rem",
            },
            oninput: () => {
              this.selectedResultIndex = 0;
              this.searchNodes(document.getElementById("searchInput").value);
              this.renderSearchResults();
            },
          }),
          $el("tbody", { $: (tbody) => (this.textElement = tbody) }),
        ]),
      ]
    );

    window.addEventListener("keydown", (e) => {
      this.keydownEventFilter(e, false, true, (e) => {
        if (this.equalsHotkey(this.config.OPEN_SEARCH_HOTKEY, e)) {
          this.show();
          e.preventDefault();
        }
      });
      this.keydownEventFilter(e, true, true, (e) => {
        if (this.equalsHotkey(this.config.FOCUS_SEARCH_INPUT_HOTKEY, e)) {
          this.focusSearchInput();
        }
      });
      this.keydownEventFilter(
        e,
        !this.config.UNDOREDO_NAVIGATION_WHEN_CLOSED,
        document.activeElement &&
          document.activeElement !== this.getSearchInputEl(),
        (e) => {
          if (this.equalsHotkey(this.config.UNDO_HOTKEY, e)) {
            this.undo();
          } else if (this.equalsHotkey(this.config.REDO_HOTKEY, e)) {
            this.redo();
          }
        }
      );
    });
  }

  equalsHotkey(hotkey, e) {
    const parts = hotkey.toLowerCase().split("+");
    let key = parts.pop();
    let modifiers = parts.map((modifier) => modifier.trim());
    return (
      key === e.key.toLowerCase() &&
      modifiers.every((modifier) => e[`${modifier}Key`])
    );
  }

  getGraphState() {
    const curState = this.app.graph.serialize();
    this.curOffset = curState.extra.ds.offset;
    this.curScale = curState.extra.ds.scale;
    return curState;
  }

  undo() {
    if (this.undoStack.length > 0) {
      const lastOffset = this.undoStack.pop();
      const graphState = this.getGraphState();
      const curOffset = graphState.extra.ds.offset;
      this.redoStack.push(JSON.parse(JSON.stringify(curOffset)));
      this.setView(lastOffset, graphState, false);
    }
  }

  redo() {
    if (this.redoStack.length > 0) {
      const lastOffset = this.redoStack.pop();
      const graphState = this.getGraphState();
      const curOffset = graphState.extra.ds.offset;
      this.undoStack.push(JSON.parse(JSON.stringify(curOffset)));
      this.setView(lastOffset, graphState, false);
    }
  }

  setView(offset, curGraphState, addToUndoStack = true) {
    if (this.curOffset === offset) {
      return;
    }
    curGraphState.extra.ds.offset = offset;
    let clone = JSON.parse(JSON.stringify(curGraphState));
    if (addToUndoStack) {
      this.undoStack.push(this.curOffset);
    }
    api.dispatchEvent(new CustomEvent("graphChanged", { detail: clone }));
    this.app.loadGraphData(clone, false);
  }
  centerViewOnNode(node) {
    const graph = this.getGraphState();
    const [nodePosX, nodePosY] = node.pos;
    const [nodeSizeX, nodeSizeY] = node.size;

    const canvasCenterX = window.innerWidth / 2;
    const canvasCenterY = window.innerHeight / 2;

    const nodeCenterX = nodePosX + nodeSizeX / 2;
    const nodeCenterY = nodePosY + nodeSizeY / 2;

    const newOffsetX = canvasCenterX / this.curScale - nodeCenterX;
    const newOffsetY = canvasCenterY / this.curScale - nodeCenterY;
    this.setView([newOffsetX, newOffsetY], graph);
  }

  renderSearchResults() {
    this.textElement.innerHTML = "";
    this.currentResults.forEach((result, index) => {
      const tr = $el("tr", [
        $el("td", { textContent: result.type }),
        // $el("td", { textContent: result.properties["Node name for S&R"] }),
      ]);
      if ("title" in result) {
        tr.appendChild($el("td", { textContent: result.title }));
      }
      if (this.config.SHOW_NODE_IDS) {
        tr.appendChild($el("td", { textContent: result.id }));
      }
      if (index === this.selectedResultIndex) {
        // Selected row color.
        tr.style.backgroundColor = "rgba(9, 71, 113, 0.78)";
      }
      this.textElement.appendChild(tr);
    });
  }

  enterHandler() {
    if (this.currentResults.length > 0) {
      if (this.selectedResultIndex >= this.currentResults.length) {
        this.selectedResultIndex = this.currentResults.length - 1;
      }
      this.centerViewOnNode(this.currentResults[this.selectedResultIndex]);
      this.clearSearchInput();
    }
  }

  getId(id) {
    if (this.app.storageLocation === "browser") {
      id = "Comfy.SearchNavigation." + id;
    }
    return id;
  }

  incrementSelectionIndex(increment) {
    let newIndex = this.selectedResultIndex + increment;
    if (newIndex >= this.currentResults.length) {
      newIndex = 0;
    }
    if (newIndex < 0) {
      newIndex = this.currentResults.length - 1;
    }
    this.selectedResultIndex = newIndex;
    this.renderSearchResults();
  }

  searchNodes(searchText) {
    if (searchText === "" && !this.config.ALLOW_EMPTY_SEARCH) {
      this.currentResults = [];
      return;
    }

    searchText = searchText.toLowerCase();
    const graph = this.getGraphState();
    const nodes = graph.nodes;
    const results = [];

    const targetNodeValues = ["type", "title"];
    const targetPropertyValues = ["Node name for S&R"];
    for (const node of nodes) {
      let match = false;
      targetNodeValues.forEach((prop) => {
        if (node[prop]?.toLowerCase().includes(searchText)) {
          match = true;
        }
      });
      if (!match) {
        targetPropertyValues.forEach((prop) => {
          if (node.properties[prop]?.toLowerCase().includes(searchText)) {
            match = true;
          }
        });
      }
      if (match) {
        results.push(node);
      }
    }
    this.currentResults = results;
    return results;
  }

  keydownEventFilter(e, disableWhenHidden, disableWhenTextArea, callback) {
    if (
      (disableWhenHidden && !this.visible) ||
      (disableWhenTextArea &&
        document.activeElement &&
        (document.activeElement instanceof HTMLTextAreaElement ||
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement === this.getSearchInputEl()))
    ) {
      return false;
    }
    return callback(e);
  }

  getSearchInputEl() {
    return document.getElementById("searchInput");
  }

  clearSearchInput() {
    this.getSearchInputEl().value = "";
    this.textElement.innerHTML = "";
    this.currentResults = [];
  }

  focusSearchInput() {
    this.getSearchInputEl().focus();
  }

  show() {
    if (this.visible) {
      this.element.classList.remove("search-navigation-show");
      this.element.close();
    } else {
      this.element.classList.add("search-navigation-show");
      this.element.show();
      this.focusSearchInput();
      this.clearSearchInput();
    }
    this.visible = !this.visible;
  }

  toggleSettings() {
    if (this.settingsOpen) {
      this.textElement.innerHTML = "";
    } else {
      this.openSettings();
    }
    this.settingsOpen = !this.settingsOpen;
  }

  reRenderSettings() {
    this.textElement.innerHTML = "";
    this.openSettings();
  }

  openSettings() {
    this.clearSearchInput();
    const settingsRow = $el("tr", {
      style: {
        display: "grid",
        gridTemplateColumns:
          this.config.NAV_WIDTH >= 80
            ? "repeat(3, 1fr)"
            : this.config.NAV_WIDTH >= 50
            ? "repeat(2, 1fr)"
            : "1fr",
        gap: "1rem",
      },
    });

    for (let [key, value] of Object.entries(this.config)) {
      const cell = $el("td", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          fontSize: this.config.NAV_WIDTH >= 40 ? ".8rem" : ".64rem",
        },
      });

      cell.appendChild($el("label", { textContent: key, style: {} }));

      const input = $el("input", {
        type:
          typeof value === "boolean"
            ? "checkbox"
            : typeof value === "number"
            ? "number"
            : "text",
        value,
        oninput: (e) => {
          if (
            key == "NAV_WIDTH" &&
            !isNaN(parseInt(e.target.value)) &&
            parseInt(e.target.value) >= 10
          ) {
            let oldValue = parseInt(this.config[key]);
            this.element.style.width =
              parseInt(e.target.value) >= 10 ? `${e.target.value}vw` : "70vw"; // Default width so doesn't get too small when changing via keyboard.

            if (Math.abs(parseInt(e.target.value) - oldValue) >= 10) {
              this.config[key] = parseInt(e.target.value);
              this.reRenderSettings();
            }
          } else if (typeof value === "boolean") {
            this.config[key] = e.target.checked;
          } else if (key !== "NAV_WIDTH") {
            this.config[key] = e.target.value;
          }
        },
      });
      if (typeof value === "boolean") {
        input.checked = value;
      }
      cell.appendChild(input);
      settingsRow.appendChild(cell);
    }

    this.textElement.appendChild(settingsRow);
  }
}

const SearchNavgiationExtension = {
  name: "searchNavigation",
  init: async (app) => {
    document.head.appendChild(
      $el("style", {
        textContent: `
          @keyframes searchNavSlideDown {
            from {
              transform: translateY(-100%);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }

          .search-navigation-show {
            display: flex;
            animation: searchNavSlideDown 0.2s forwards;
          }
        `,
      })
    );

    ComfyUI.searchNavigation = new SearchNavigation(app);
    if (SHOW_ON_LOAD) {
      ComfyUI.searchNavigation.show();
    }
  },
};

app.registerExtension(SearchNavgiationExtension);

import { $el, ComfyUI } from "../../scripts/ui.js";
import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";
import { ComfyDialog } from "../../scripts/ui/dialog.js";

const NAV_WIDTH = 80;
const OPEN_SEARCH_HOTKEY = "F";
const UNDO_HOTKEY = "ArrowLeft";
const REDO_HOTKEY = "ArrowRight";
const SHOW_ON_LOAD = false;

export class SearchNavigation extends ComfyDialog {
  constructor(app) {
    super();
    this.app = app;
    this.selectedResultIndex = 0;
    this.currentResults = [];
    this.curOffset = null;
    this.undoStack = [];
    this.redoStack = [];
    this.visible = false;
    this.element = $el(
      "dialog",
      {
        id: "comfy-search-navigation",
        parent: document.body,
        onkeydown: (e) => {
          if (e.key === "Enter") {
            this.enterHandler();
          } else if (e.key === "ArrowDown") {
            this.incrementSelectedResultIndex(1);
          } else if (e.key === "ArrowUp") {
            this.incrementSelectedResultIndex(-1);
          }
        },
        style: {
          position: "fixed",
          top: "0",
          left: "0",
          transform: "translateX(-50%) translateY(-100%)",
          width: `${NAV_WIDTH}vw`,
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
          $el(
            "caption",
            { textContent: "Search Navigation" },
            $el("button.comfy-btn", {
              type: "button",
              textContent: "\u00d7",
              onclick: () => {
                this.show();
              },
            })
          ),
          $el("input", {
            type: "text",
            id: "searchInput",
            placeholder: "Search Nodes...",
            style: {
              marginBottom: ".5rem",
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

    window.addEventListener("keyup", (e) => {
      if (e.shiftKey && e.key === OPEN_SEARCH_HOTKEY) {
        this.show();
      }
    });
    this.undoRedoListeners = this.addUndoRedoHotkeyListeners();
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
        $el("td", { textContent: result.id }),
        $el("td", { textContent: result.title }),
        $el("td", { textContent: result.properties["Node name for S&R"] }),
      ]);
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

  incrementSelectedResultIndex(increment) {
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

  undoRedoListener(e) {
    if (!this.visible) return;

    if (e.shiftKey && e.key === UNDO_HOTKEY) {
      this.undo();
    } else if (e.shiftKey && e.key === REDO_HOTKEY) {
      this.redo();
    }
  }

  addUndoRedoHotkeyListeners() {
    // Ensure we remove any existing listener before adding a new one.
    if (this.undoRedoListenerRef) {
      this.removeUndoRedoHotkeyListeners(); 
    }

    const listener = this.undoRedoListener.bind(this);
    window.addEventListener("keyup", listener);
    this.undoRedoListenerRef = listener; // Store the bound listener reference
  }

  removeUndoRedoHotkeyListeners() {
    if (this.undoRedoListenerRef) {
      window.removeEventListener("keyup", this.undoRedoListenerRef);
      this.undoRedoListenerRef = null;
    }
  }

  show() {
    if (this.visible) {
      this.element.classList.remove("search-navigation-show");
      this.element.close();
      this.removeUndoRedoHotkeyListeners(); // Remove listeners when hidden
    } else {
      this.element.classList.add("search-navigation-show");
      this.element.show();
      this.addUndoRedoHotkeyListeners(); // Add listeners when shown
      this.focusSearchInput();
    }
    this.visible = !this.visible;
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

import { useCallback, useEffect, useRef, useState } from "react";
import { GridStack, useGridStack } from "gridstack/dist/react";
import type { GridStackHandle, GridStackWidget } from "gridstack/dist/react";
import "gridstack/dist/gridstack.css";
import "./App.css";

function Placeholder({ title, color }: Record<string, unknown>) {
  return (
    <div className="ph" style={{ background: String(color ?? "#4a6fa5") }}>
      <strong>{String(title ?? "widget")}</strong>
    </div>
  );
}

function StatBox({ label, value }: Record<string, unknown>) {
  return (
    <div className="stat">
      <div className="stat-label">{String(label ?? "")}</div>
      <div className="stat-value">{String(value ?? "")}</div>
    </div>
  );
}

const components = { Placeholder, StatBox };

const initialWidgets: GridStackWidget[] = [
  { id: "w1", x: 0, y: 0, w: 4, h: 3, component: "Placeholder", props: { title: "A", color: "#4a6fa5" } },
  { id: "w2", x: 4, y: 0, w: 4, h: 2, component: "StatBox", props: { label: "CPU", value: "23%" } },
  { id: "w3", x: 8, y: 0, w: 4, h: 4, component: "Placeholder", props: { title: "C", color: "#7d4a5c" } },
  { id: "w4", x: 0, y: 3, w: 8, h: 2, component: "Placeholder", props: { title: "D", color: "#4a7d6b" } },
];

function Toolbar() {
  const { grid, save, addWidget, removeWidget } = useGridStack();
  const [json, setJson] = useState("");
  const [savedLen, setSavedLen] = useState(0);
  const [cols, setCols] = useState<number | null>(null);
  const seq = useRef(100);

  const refreshCols = useCallback(() => {
    setTimeout(() => setCols(grid?.getColumn() ?? null), 350);
  }, [grid]);
  useEffect(() => {
    refreshCols();
    window.addEventListener("resize", refreshCols);
    return () => window.removeEventListener("resize", refreshCols);
  }, [refreshCols]);

  return (
    <div className="toolbar">
      <button
        data-testid="save"
        onClick={() => {
          const data = JSON.stringify(save(false, false), null, 1);
          setJson(data);
          setSavedLen(data.length);
        }}
      >
        Save
      </button>
      <button
        data-testid="add"
        onClick={() => {
          const n = seq.current++;
          addWidget({
            id: `n${n}`,
            x: 0,
            y: 10,
            w: 3,
            h: 2,
            component: "Placeholder",
            props: { title: `N${n}`, color: "#6b5a7d" },
          });
        }}
      >
        Add widget
      </button>
      <button
        data-testid="remove-last"
        onClick={() => {
          const items = grid?.getGridItems() ?? [];
          const last = items[items.length - 1];
          if (last) removeWidget(last);
        }}
      >
        Remove last
      </button>
      <button
        data-testid="load"
        onClick={() => {
          if (json) grid?.load(JSON.parse(json) as GridStackWidget[]);
        }}
      >
        Load JSON
      </button>
      <span data-testid="columns">columns: {cols ?? "?"}</span>
      <span data-testid="saved-len">{savedLen > 0 ? `saved ${savedLen} chars` : "nothing saved"}</span>
      <textarea data-testid="json" value={json} readOnly rows={6} placeholder="layout JSON appears here" />
    </div>
  );
}

export default function App() {
  const gridRef = useRef<GridStackHandle>(null);
  const [, setTick] = useState(0);

  const handleChanged = useCallback(() => setTick((t) => t + 1), []);

  return (
    <div id="app">
      <h1>M0 spike · gridstack v14 React wrapper</h1>
      <GridStack
        ref={gridRef}
        options={{
          column: 12,
          cellHeight: 80,
          margin: 6,
          mode: "float",
          minRow: 1,
          columnOpts: {
            breakpoints: [
              { w: 1200, c: 12 },
              { w: 900, c: 8 },
              { w: 600, c: 4 },
              { w: 480, c: 2 },
            ],
            layout: "moveScale",
          },
          children: initialWidgets,
        }}
        components={components}
        onChange={handleChanged}
      >
        <Toolbar />
      </GridStack>
    </div>
  );
}

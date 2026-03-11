import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./app.css";

// Suppress benign ResizeObserver loop errors (triggered by ReactFlow node resizing)
const resizeObserverErr = (e: ErrorEvent) => {
  if (e.message === "ResizeObserver loop completed with undelivered notifications.") {
    e.stopImmediatePropagation();
  }
};
window.addEventListener("error", resizeObserverErr);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

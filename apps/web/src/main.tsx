import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { ErrorBoundary } from "../../../debug/src/ErrorBoundary.js";
import "../../../debug/src/styles.css";
import "./styles.css";

const app = (
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById("root")!).render(app);

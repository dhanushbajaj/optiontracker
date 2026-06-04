import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProvider } from "./store";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);

// Register the service worker (PWA install + push) in production builds only —
// a SW caching dev assets would break Vite HMR.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err) => console.warn("SW registration failed:", err));
  });
} else if (import.meta.env.DEV && "serviceWorker" in navigator) {
  // Make sure no stale SW from a prior build interferes with HMR.
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  if (typeof caches !== "undefined") caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
}

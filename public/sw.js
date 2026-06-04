// Option Oracle service worker — push notifications + PWA install.
// Intentionally NO fetch handler: the app is online-first (always wants fresh
// reports) and intercepting navigations risks serving a stale shell. v2.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // Drop any caches created by older SW versions.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Push from the scheduled scan -> phone notification.
self.addEventListener("push", (e) => {
  let data = { title: "Option Oracle", body: "New market report is ready.", tag: "report" };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "./icon.svg",
      badge: "./icon.svg",
      vibrate: [80, 40, 80],
      data: { url: "./" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    })
  );
});

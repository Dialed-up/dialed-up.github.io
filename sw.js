// DialedUp service worker: shows notifications and opens the app when one is tapped.
self.addEventListener("install", () => self.skipWaiting());

// Always use the newest copy of DialedUp's own files when online (phones love to keep stale ones);
// fall back to a saved copy when offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || !/\.(js|css|html|webmanifest)$|\/$/.test(url.pathname)) return;
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: "no-cache" });
      if (fresh.ok) (await caches.open("du-files")).put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch {
      return (await caches.match(req)) || Response.error();
    }
  })());
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => {
  if (e.data?.type === "badge") e.waitUntil(caches.open("du-badge").then((c) => c.put("badge-count", new Response(String(e.data.count || 0)))));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.includes(url.replace("./", "")) ) || list[0];
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
// Ready for real push later (needs a small sender server).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: "DialedUp", body: e.data?.text() || "" }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || "DialedUp", { body: d.body || "", tag: d.tag, icon: "img/icon-192-d1794979108.png", data: { url: d.url || "./" } });
    // Red number on the app icon: one per waiting alert (the app corrects it when opened)
    try {
      const shown = await self.registration.getNotifications();
      const prev = Number((await caches.match("badge-count").then((r) => r?.text()).catch(() => 0)) || 0);
      const count = Math.max(shown.length, prev + 1);
      await (await caches.open("du-badge")).put("badge-count", new Response(String(count)));
      if (self.navigator.setAppBadge) await self.navigator.setAppBadge(count);
    } catch {}
  })());
});

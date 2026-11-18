// DialedUp service worker: shows notifications and opens the app when one is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
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
  e.waitUntil(self.registration.showNotification(d.title || "DialedUp", { body: d.body || "", icon: "img/icon-192-d1794979108.png", data: { url: d.url || "./" } }));
});

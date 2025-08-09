self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => self.clients.claim());
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.title) {
    self.registration.showNotification(d.title, d.options || {});
  }
});

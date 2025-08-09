/* self.__WB_MANIFEST is injected at build time by vite-plugin-pwa */
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

// App shell navigation fallback
registerRoute(
  new NavigationRoute(({ request, url }) => {
    return caches.match("/index.html");
  })
);

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.title && self.registration?.showNotification) {
    self.registration.showNotification(d.title, d.options || {});
  }
});

// Optional: background notifications via Web Push
self.addEventListener("push", (event) => {
  try {
    const data =
      (() => {
        try {
          return event.data?.json();
        } catch {
          return { title: event.data?.text() };
        }
      })() || {};
    const title = data.title || "Notification";
    const options = data.options || { body: data.body };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch {}
});

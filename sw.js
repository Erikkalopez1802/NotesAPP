self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("libreta-v1").then((cache) => cache.addAll(["./", "./index.html", "./styles.css", "./app.js"]))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

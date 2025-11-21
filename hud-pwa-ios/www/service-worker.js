// service-worker.js

const CACHE_NAME = "hud-navi-v1";
const ASSETS = [
    "/",          // 루트
    "/index.html",
    "/app.js",
    "/manifest.json",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key)))
                )
            )
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request);
        })
    );
});

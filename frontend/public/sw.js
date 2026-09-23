self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Administrative pages and API responses intentionally stay network-only.
// This prevents sensitive campaign or authentication data from being written
// to a service-worker cache on a shared computer.

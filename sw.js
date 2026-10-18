/* Service worker : hors ligne + mise à jour simple.
   Pour une nouvelle version : modifie CACHE (ex. muscu-1.0.1). */
const CACHE = 'muscu-1.0.0';
const ASSETS = ['./', './index.html', './style.css', './data.js', './app.js', './manifest.webmanifest', './icons/icon.svg'];
const OPTIONAL = ['./icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    await Promise.all(OPTIONAL.map(u => c.add(u).catch(() => {})));
  })());
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('muscu-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
/* Stratégie « stale-while-revalidate » : réponse immédiate depuis le cache,
   mise à jour en arrière-plan. Seuls les fichiers de l'app sont mis en cache ;
   tes performances restent dans localStorage et ne passent jamais par le réseau. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await c.match('./index.html') : undefined);
    const network = fetch(req).then(res => { if (res.ok && res.type === 'basic') c.put(req, res.clone()); return res; }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    return (await network) || new Response('Hors ligne', { status: 503, statusText: 'Hors ligne' });
  })());
});

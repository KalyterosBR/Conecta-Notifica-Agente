// Kill-switch: havia um service worker de outro projeto registrado em
// localhost:3000 interceptando os fetches do painel. Este SW se instala no
// lugar dele, se desregistra, limpa os caches e recarrega as abas.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      const chaves = await caches.keys();
      await Promise.all(chaves.map((c) => caches.delete(c)));
      const abas = await self.clients.matchAll({ type: 'window' });
      abas.forEach((aba) => aba.navigate(aba.url));
    })(),
  );
});

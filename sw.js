// Service worker de "Senhores da Guerra": deixa o jogo instalável e jogável sem internet.
//
// Estratégia: rede primeiro, cache como reserva (as imagens com ?v=<hash> vêm direto do cache: não mudam).
//  - com internet, o jogo sempre abre na versão mais nova publicada (e ela vai para o cache);
//  - sem internet, ou se a rede demorar demais, abre a última versão guardada.
// Por isso não é preciso mexer neste arquivo a cada atualização do jogo: basta publicar o index.html novo.
// Só troque o número em CACHE se mudar a lista ARQUIVOS ou quiser forçar a limpeza do cache antigo.
const CACHE = 'senhores-do-veu-v7';
const ARQUIVOS = ['./', 'index.html', 'manifest.webmanifest', 'icones/icone-192.png', 'icones/icone-512.png', 'icones/icone-mask-512.png', 'icones/apple-180.png', 'fontes/PirataOne.woff2',
  'img/atlas.png', 'img/atlas-cor.png', 'img/elementais.png',
  'img/f1-filhote-mapa.png', 'img/f1-filhote-luta.png', 'img/f1-camponeses.png', 'img/f1-rostos.png', 'img/f1-soldados.png'];
const ESPERA_REDE = 4000; // ms: passou disso, usa o cache (a resposta da rede ainda atualiza o cache quando chegar)

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // imagens com ?v=<hash> nunca mudam naquele endereço (a versão nova ganha outro hash): vêm direto do cache
  ev.respondWith(new URL(req.url).searchParams.has('v') ? cacheVersionado(req) : redePrimeiro(req));
});

async function cacheVersionado(req) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req); // com o ?v= exato: hash diferente = arquivo novo, vai à rede
  if (guardado) return guardado;
  let resp;
  try { resp = await fetch(req); }
  catch (e) { // sem internet: serve a versão guardada que houver, mesmo de outro ?v=
    const outra = await cache.match(req, { ignoreSearch: true });
    if (outra) return outra;
    throw e;
  }
  if (resp.ok) {
    cache.put(req, resp.clone());
    // tira do cache as versões antigas do mesmo arquivo (outros ?v=)
    const base = req.url.split('?')[0];
    for (const k of await cache.keys()) if (k.url.split('?')[0] === base && k.url !== req.url) cache.delete(k);
  }
  return resp;
}

async function redePrimeiro(req) {
  const cache = await caches.open(CACHE);
  // 'no-cache' = sempre pergunta ao servidor se mudou (resposta curta quando não mudou)
  const daRede = fetch(req, { cache: 'no-cache' }).then(resp => {
    // guarda sem o ?v=...: cada arquivo ocupa um lugar só no cache, e a versão nova substitui a antiga
    if (resp.ok) cache.put(req.url.split('?')[0], resp.clone());
    return resp;
  });
  const doCache = async () =>
    (await cache.match(req, { ignoreSearch: true })) ||
    (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
  try {
    const resp = await Promise.race([
      daRede,
      new Promise((_, falha) => setTimeout(() => falha(new Error('rede lenta')), ESPERA_REDE)),
    ]);
    if (resp.ok) return resp;
    return (await doCache()) || resp;
  } catch (e) {
    const guardado = await doCache();
    if (guardado) { daRede.catch(() => {}); return guardado; }
    return daRede; // nada no cache: espera a rede até o fim
  }
}

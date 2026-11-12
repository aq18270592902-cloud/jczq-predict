/* 竞足预测汇总 · Service Worker
   演示站（GitHub Pages）静态快照：
   - 页面导航 network-first（断网回落到缓存）
   - app.js / data.js / style.css stale-while-revalidate（先给缓存，后台静默更新，下次打开就是新的）
   - 图标等不变资源 cache-first
   /api/* 一律不缓存，避免把本机服务端的响应写进离线缓存。
   改缓存策略时把 CACHE 版本号 +1，老缓存会在 activate 时清掉。 */
const CACHE = "jczq-v2";
const CORE = [
  "./",
  "./index.html",
  "./app.js",
  "./data.js",
  "./style.css",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];
/* 每天都会变、必须尽快看到新版本的文件 */
const REVALIDATE = ["./app.js", "./data.js", "./style.css", "./index.html", "./"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(req, res) {
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    e.respondWith(
      fetch(req).then((res) => put(req, res))
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  const path = url.pathname.replace(/\/$/, "/") ;
  const isFresh = REVALIDATE.some((p) => {
    const clean = p.replace(/^\.\//, "/");
    return path === clean || path.endsWith(clean);
  });

  if (isFresh) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => put(req, res)).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res)))
  );
});

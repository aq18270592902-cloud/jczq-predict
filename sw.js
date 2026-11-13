/* 竞足预测汇总 · Service Worker
   页面结构：index.html → boot.js（串行加载 data.js → 体彩实时接口 → app.js）

   缓存策略：
   - 页面导航 index.html：network-first（断网回落缓存）
   - boot.js / app.js / data.js / style.css：stale-while-revalidate
     （先给缓存保证首屏秒开，后台静默换新；赔率实时性由 boot.js 直连体彩接口负责，
       不依赖这里的缓存是否新鲜）
   - 图标等不变资源：cache-first
   - 跨域（体彩接口）与 /api/* 一律不拦截、不缓存

   改缓存策略时把 CACHE 版本号 +1，老缓存在 activate 时清掉。

   注意：SW 只挡得住它自己缓存的副本，挡不住浏览器 HTTP 缓存。两套部署的
   Cache-Control 不一样，但 boot.js 的 ?v= 时间桶对两边都有效：

   | 部署位置            | 静态资源默认                        | 带 ?v= 的            |
   |---------------------|-------------------------------------|----------------------|
   | GitHub Pages        | max-age=600                         | max-age=600（同左）  |
   | 自有服务器 server.js | max-age=600, must-revalidate + ETag | max-age=31536000, immutable |

   所以 boot.js 给 app.js 带 ?v=BUILD、给 data.js 带 5 分钟时间桶，
   靠 URL 变化强制绕过 HTTP 缓存 —— 这条路在两种部署下都成立。 */
const CACHE = "jczq-v6";
const CORE = [
  "./",
  "./index.html",
  "./boot.js",
  "./app.js",
  "./data.js",
  "./style.css",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];
/* 每次发版都可能变、必须尽快看到新版本的文件 */
const REVALIDATE = ["./boot.js", "./app.js", "./data.js", "./style.css", "./index.html", "./"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: "reload" })))))
      .then(() => self.skipWaiting())
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
  /* 只缓存 200 且非 opaque 的同源响应，避免把错误页写进缓存 */
  if (!res || res.status !== 200 || res.type === "opaque") return res;
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      /* 体彩接口等跨域请求完全不介入 */
  if (url.pathname.startsWith("/api/")) return;    /* 本机后端接口不缓存 */

  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    e.respondWith(
      fetch(req).then((res) => put(req, res))
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  const path = url.pathname;
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

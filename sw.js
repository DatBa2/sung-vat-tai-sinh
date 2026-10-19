/**
 * SERVICE WORKER — Sủng Vật Tái Sinh (nhánh TOI_UU 19/10). Đăng ký bởi src/shared/sw.ts (chỉ bản build, không vite dev).
 *
 *  - Trang (index.html / điều hướng): MẠNG TRƯỚC (hỏi lại máy chủ, 304 nếu không đổi) → mất mạng thì trả bản đã lưu.
 *  - File của bản build (có trong ban_ke.json — tools/dong_goi_sw.mjs sinh lúc build): BỘ ĐỆM TRƯỚC — có rồi thì trả
 *    ngay, chưa có thì tải rồi lưu. File KHÔNG có trong bản kê (vd module của vite dev) → đi thẳng mạng, không lưu.
 *  - dinh_dang_anh.json / yêu cầu cache:'no-store': mạng trước, lỗi mạng mới dùng bản lưu.
 *  - Bản mới: index.html mang <meta name="phien-ban">; khác bản đang lưu → tải ban_ke.json mới, XÓA khỏi bộ đệm đúng
 *    những file đã đổi/bị bỏ (TRƯỚC khi trả trang → trang mới không bao giờ lấy nhầm ảnh cũ), file không đổi giữ nguyên.
 *  - index.html KHÔNG có meta phien-ban (vd chạy vite dev cùng cổng với bản preview cũ) → tự gỡ đăng ký + xóa bộ đệm.
 *  - Trang gửi {loai:'chep', urls} = những file đã tải TRƯỚC khi SW nắm quyền → SW chép vào bộ đệm từ bộ nhớ đệm HTTP
 *    (cache:'force-cache', không tải lại qua mạng) → lần mở thứ 2 không phải tải gì.
 * Đường dẫn tương đối theo phạm vi SW (GitHub Pages đường dẫn con /sung-vat-tai-sinh/).
 */
const KHO = 'svts-tep-v1';
const PHAM_VI = new URL(self.registration.scope);
const KHOA_TRANG = new URL('index.html', PHAM_VI).href;
const KHOA_BAN_KE = new URL('__ban_ke__', PHAM_VI).href;
const URL_BAN_KE = new URL('ban_ke.json', PHAM_VI).href;

/** bản kê đang dùng (bộ nhớ) — SW bị tắt/bật lại thì đọc lại từ bộ đệm */
let banKe = null;
/** đã tự gỡ (trang không phải bản build) → mọi yêu cầu đi thẳng mạng */
let rutLui = false;
let dangDongBo = null;

async function docBanKe() {
  if (banKe) return banKe;
  const kho = await caches.open(KHO);
  const r = await kho.match(KHOA_BAN_KE);
  banKe = r ? await r.json().catch(() => null) : null;
  return banKe;
}

/** đồng bộ bản kê với phiên bản `v` (của index.html mới) — xóa file đã đổi khỏi bộ đệm */
function dongBoBanKe(v) {
  if (dangDongBo) return dangDongBo;
  dangDongBo = (async () => {
    const cu = await docBanKe();
    if (cu && v && cu.phien_ban === v) return;
    const res = await fetch(URL_BAN_KE, { cache: 'no-store' });
    if (!res.ok) return;
    const moi = await res.json();
    const kho = await caches.open(KHO);
    for (const req of await kho.keys()) {
      if (req.url === KHOA_TRANG || req.url === KHOA_BAN_KE) continue;
      const rel = tuongDoi(req.url);
      const hMoi = rel && moi.tep[rel];
      const hCu = rel && cu && cu.tep[rel];
      // bỏ khỏi bản build, hoặc đổi nội dung, hoặc không biết bản cũ (an toàn: xóa) → xóa
      if (!hMoi || !cu || hMoi !== hCu) await kho.delete(req);
    }
    await kho.put(KHOA_BAN_KE, new Response(JSON.stringify(moi), { headers: { 'Content-Type': 'application/json' } }));
    banKe = moi;
  })()
    .catch((e) => console.warn('[sw] đồng bộ bản kê lỗi', e))
    .finally(() => (dangDongBo = null));
  return dangDongBo;
}

/** đường dẫn tương đối theo phạm vi SW (không query) hoặc null nếu ngoài phạm vi */
function tuongDoi(href) {
  const u = new URL(href);
  if (u.origin !== PHAM_VI.origin || !u.pathname.startsWith(PHAM_VI.pathname)) return null;
  return decodeURIComponent(u.pathname.slice(PHAM_VI.pathname.length));
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(dongBoBanKe(null));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== KHO && k.startsWith('svts-')) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

async function trang(req) {
  const kho = await caches.open(KHO);
  try {
    // (Request điều hướng không tạo lại kèm tùy chọn được → hỏi theo URL) no-cache: luôn hỏi lại máy chủ, 304 nếu không đổi
    const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (res.ok && res.status === 200) {
      const html = await res.clone().text();
      const v = /<meta name="phien-ban" content="([^"]+)"/.exec(html)?.[1];
      if (!v) {
        // không phải bản build (vite dev chạy trùng cổng) → SW tự rút lui, không đệm gì nữa
        rutLui = true;
        banKe = null;
        await caches.delete(KHO);
        await self.registration.unregister();
        return res;
      }
      await dongBoBanKe(v);
      await kho.put(KHOA_TRANG, res.clone());
    }
    return res;
  } catch (e) {
    const luu = await kho.match(KHOA_TRANG);
    if (luu) return luu;
    throw e;
  }
}

async function mangTruoc(req) {
  try {
    const res = await fetch(req);
    if (res.ok && res.status === 200) {
      const kho = await caches.open(KHO);
      await kho.put(req.url, res.clone());
    }
    return res;
  } catch (e) {
    const luu = await (await caches.open(KHO)).match(req.url);
    if (luu) return luu;
    throw e;
  }
}

async function demTruoc(req, e) {
  const kho = await caches.open(KHO);
  const luu = await kho.match(req.url);
  if (luu) return luu;
  const res = await fetch(req);
  if (res.ok && res.status === 200 && res.type === 'basic') {
    const luuVao = kho.put(req.url, res.clone()).catch(() => undefined);
    try {
      e.waitUntil(luuVao);
    } catch {
      /* sự kiện đã xong — việc lưu vẫn chạy tiếp */
    }
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (rutLui || req.method !== 'GET' || req.headers.has('range')) return;
  const rel = tuongDoi(req.url);
  if (rel === null) return;
  if (req.mode === 'navigate' || rel === '' || rel === 'index.html') {
    e.respondWith(trang(req));
    return;
  }
  if (rel === 'sw.js' || rel === 'ban_ke.json') return;
  if (rel === 'dinh_dang_anh.json' || req.cache === 'no-store') {
    e.respondWith(mangTruoc(req));
    return;
  }
  e.respondWith(
    (async () => {
      const bk = await docBanKe();
      // chỉ đệm file của bản build (có trong bản kê)
      if (!bk || !bk.tep[rel]) return fetch(req);
      return demTruoc(req, e);
    })(),
  );
});

/** trang gửi danh sách file đã tải trước khi SW nắm quyền → chép vào bộ đệm từ bộ nhớ đệm HTTP (không tải lại) */
async function chep(urls) {
  if (rutLui) return;
  const bk = await docBanKe();
  if (!bk) return;
  const kho = await caches.open(KHO);
  const ds = [...new Set(urls)].filter((u) => {
    const rel = tuongDoi(u);
    return rel && bk.tep[rel];
  });
  let i = 0;
  const luong = async () => {
    while (i < ds.length) {
      const u = ds[i++];
      if (await kho.match(u)) continue;
      try {
        const res = await fetch(u, { cache: 'force-cache' });
        if (res.ok && res.status === 200 && res.type === 'basic') await kho.put(u, res);
      } catch {
        /* bỏ qua */
      }
    }
  };
  await Promise.all([luong(), luong(), luong(), luong()]);
}

self.addEventListener('message', (e) => {
  const d = e.data;
  if (d && d.loai === 'chep' && Array.isArray(d.urls)) e.waitUntil(chep(d.urls));
});

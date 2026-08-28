const AUTO_CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.v1";
const AUTO_LOCK_KEY = "BiliBili.Redirect.CCBStyle.speed.lock.v1";
const AUTO_LOCK_TTL_MS = 30 * 1000;
const AUTO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const AUTO_HEADER = "X-CCB-Speedtest";
const CCB_DATA_URLS = [
  "https://cdn.jsdelivr.net/gh/Kanda-Akihito-Kun/ccb@main/data/cdn.json",
  "https://raw.githubusercontent.com/Kanda-Akihito-Kun/ccb/main/data/cdn.json",
];

const STAGE1_BYTES = 128 * 1024;
const STAGE1_TIMEOUT_MS = 2200;
const STAGE1_CONCURRENCY = 8;
const STAGE2_BYTES = 512 * 1024;
const STAGE2_TIMEOUT_MS = 4000;
const STAGE2_CONCURRENCY = 6;
const FINAL_REGION_COUNT = 3;
const FINAL_NODES_PER_REGION = 4;

const FALLBACK_REGIONS = {
  "香港": [
    "cn-hk-eq-01-01.bilivideo.com",
    "cn-hk-eq-01-03.bilivideo.com",
    "cn-hk-eq-01-09.bilivideo.com",
    "cn-hk-eq-01-13.bilivideo.com",
  ],
  "海外": [
    "upos-sz-mirror08h.bilivideo.com",
    "upos-sz-mirroraliov.bilivideo.com",
    "upos-sz-mirrorcosov.bilivideo.com",
  ],
  "深圳": [
    "upos-sz-mirrorcos.bilivideo.com",
    "upos-sz-mirrorali.bilivideo.com",
    "upos-sz-mirrorhw.bilivideo.com",
    "upos-sz-mirror08c.bilivideo.com",
  ],
};

function getHeader(headers, wanted) {
  if (!headers || typeof headers !== "object") return undefined;
  const key = Object.keys(headers).find((name) => name.toLowerCase() === wanted.toLowerCase());
  return key ? headers[key] : undefined;
}

function isAutoEnabled(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function isSeparator(value) {
  return typeof value === "string" && /^─{2,}.*─{2,}$/.test(value.trim());
}

function rewriteRequest(cdn) {
  const url = new URL($request.url);
  url.protocol = "https:";
  url.hostname = cdn;
  url.port = "";

  const headers = { ...$request.headers };
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === "host" || name.toLowerCase() === ":authority") {
      headers[name] = cdn;
    }
  }

  console.log(`[BiliBili Redirect] ${$request.url} -> ${url.toString()}`);
  $done({ url: url.toString(), headers });
}

function networkKey() {
  try {
    const config = JSON.parse($config.getConfig());
    const ssid = config && config.ssid ? String(config.ssid) : "cellular-or-unknown";
    const mode = config && config.running_model !== undefined ? String(config.running_model) : "unknown";
    return `${ssid}|mode=${mode}`;
  } catch (_) {
    return "unknown";
  }
}

function readCacheMap() {
  try {
    const raw = $persistentStore.read(AUTO_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function loadCachedRanking() {
  const key = networkKey();
  const entry = readCacheMap()[key];
  if (!entry || typeof entry !== "object") return null;
  if (!(typeof entry.at === "number") || Date.now() - entry.at > AUTO_CACHE_TTL_MS) return null;
  if (typeof entry.best !== "string" || !entry.best) return null;
  return entry;
}

function saveRanking(entry) {
  const key = networkKey();
  const map = readCacheMap();
  map[key] = entry;
  const entries = Object.entries(map)
    .sort((a, b) => ((b[1] && b[1].at) || 0) - ((a[1] && a[1].at) || 0))
    .slice(0, 8);
  const trimmed = Object.fromEntries(entries);
  $persistentStore.write(JSON.stringify(trimmed), AUTO_CACHE_KEY);
}

function acquireTestLock() {
  const key = networkKey();
  try {
    const raw = $persistentStore.read(AUTO_LOCK_KEY);
    const current = raw ? JSON.parse(raw) : null;
    if (current && current.network === key && typeof current.at === "number" && Date.now() - current.at < AUTO_LOCK_TTL_MS) {
      return null;
    }
  } catch (_) {}

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lock = { network: key, at: Date.now(), token };
  $persistentStore.write(JSON.stringify(lock), AUTO_LOCK_KEY);
  try {
    const check = JSON.parse($persistentStore.read(AUTO_LOCK_KEY) || "null");
    return check && check.token === token ? token : null;
  } catch (_) {
    return token;
  }
}

function releaseTestLock(token) {
  if (!token) return;
  try {
    const current = JSON.parse($persistentStore.read(AUTO_LOCK_KEY) || "null");
    if (current && current.token === token) {
      // Loon has no per-key remove API, so expire the lock by overwriting it.
      $persistentStore.write(JSON.stringify({ network: current.network, at: 0, token: "" }), AUTO_LOCK_KEY);
    }
  } catch (_) {}
}

function fetchJson(url, timeout = 2500) {
  return new Promise((resolve, reject) => {
    $httpClient.get(
      {
        url,
        timeout,
        "auto-cookie": false,
        headers: { "Cache-Control": "no-cache" },
      },
      (error, response, data) => {
        if (error || !response || response.status < 200 || response.status >= 300) {
          reject(new Error(error || `HTTP ${response && response.status}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

async function loadCcbData() {
  for (const url of CCB_DATA_URLS) {
    try {
      const data = await fetchJson(url);
      if (data && typeof data === "object" && Object.keys(data).length > 0) return data;
    } catch (error) {
      console.log(`[BiliBili Redirect] 获取 CCB 节点失败: ${url} (${error})`);
    }
  }
  console.log("[BiliBili Redirect] 使用内置测速候选节点");
  return FALLBACK_REGIONS;
}

function isSafeProbeNode(node) {
  if (typeof node !== "string" || !node.endsWith(".bilivideo.com")) return false;
  const lower = node.toLowerCase();
  if (lower.includes("gotcha")) return false;
  if (/^upos-[^.]*302/i.test(lower)) return false;
  if (lower === "upos-sz-mirror14b.bilivideo.com") return false;
  return true;
}

function regionPreferredNode(region, nodes) {
  const safe = nodes.filter(isSafeProbeNode);
  if (!safe.length) return null;

  const preferred = {
    "香港": ["cn-hk-eq-01-01.bilivideo.com"],
    "海外": ["upos-sz-mirrorcosov.bilivideo.com", "upos-sz-mirroraliov.bilivideo.com", "upos-sz-mirror08h.bilivideo.com"],
    "深圳": ["upos-sz-mirrorcos.bilivideo.com", "upos-sz-mirrorali.bilivideo.com", "upos-sz-mirrorhw.bilivideo.com"],
  }[region] || [];

  return preferred.find((node) => safe.includes(node)) || safe[0];
}

function detectIsp(node) {
  const match = String(node).match(/(?:^|-)(cmcc|cm|ct|cu)(?:-|\b)/i);
  if (!match) return "other";
  const value = match[1].toLowerCase();
  return value === "cmcc" ? "cm" : value;
}

function pickDiverseNodes(region, nodes, preferredNode, maxCount) {
  const safe = nodes.filter(isSafeProbeNode);
  if (!safe.length) return [];

  const ordered = [];
  const push = (node) => {
    if (node && safe.includes(node) && !ordered.includes(node)) ordered.push(node);
  };

  push(preferredNode);

  if (region === "海外") {
    [
      "upos-sz-mirrorcosov.bilivideo.com",
      "upos-sz-mirroraliov.bilivideo.com",
      "upos-sz-mirror08h.bilivideo.com",
    ].forEach(push);
  } else if (region === "深圳") {
    [
      "upos-sz-mirrorcos.bilivideo.com",
      "upos-sz-mirrorali.bilivideo.com",
      "upos-sz-mirrorhw.bilivideo.com",
      "upos-sz-mirror08c.bilivideo.com",
    ].forEach(push);
  }

  for (const isp of ["ct", "cu", "cm", "other"]) {
    push(safe.find((node) => detectIsp(node) === isp));
  }
  safe.forEach(push);
  return ordered.slice(0, maxCount);
}

function binaryLength(data) {
  if (data == null) return 0;
  if (typeof data.byteLength === "number") return data.byteLength;
  if (typeof data.length === "number") return data.length;
  return 0;
}

function sampleUrlForNode(sampleUrl, node) {
  try {
    const url = new URL(sampleUrl);
    url.protocol = "https:";
    url.hostname = node;
    url.port = "";
    return url.toString();
  } catch (_) {
    return null;
  }
}

function probeHeaders(rangeBytes) {
  const headers = {
    Range: `bytes=0-${rangeBytes - 1}`,
    "Accept-Encoding": "identity",
    [AUTO_HEADER]: "1",
  };
  const ua = getHeader($request.headers, "user-agent");
  const referer = getHeader($request.headers, "referer");
  if (ua) headers["User-Agent"] = ua;
  if (referer) headers.Referer = referer;
  return headers;
}

function probeNode(item, sampleUrl, rangeBytes, timeout) {
  return new Promise((resolve) => {
    const url = sampleUrlForNode(sampleUrl, item.node);
    if (!url) {
      resolve({ ...item, ok: false, mbps: 0, bytes: 0, elapsed: 0, status: 0 });
      return;
    }

    const started = Date.now();
    $httpClient.get(
      {
        url,
        timeout,
        headers: probeHeaders(rangeBytes),
        "binary-mode": true,
        "auto-redirect": false,
        "auto-cookie": false,
        alpn: "h2",
      },
      (error, response, data) => {
        const elapsed = Math.max(1, Date.now() - started);
        const bytes = binaryLength(data);
        const status = response && response.status ? response.status : 0;
        const acceptedStatus = status === 206 || (status === 200 && bytes > 0 && bytes <= rangeBytes * 1.25);
        const ok = !error && acceptedStatus && bytes > 0;
        const mbps = ok ? (bytes * 8 / 1e6) / (elapsed / 1000) : 0;
        resolve({
          ...item,
          ok,
          mbps,
          bytes,
          elapsed,
          status,
          error: error ? String(error) : null,
        });
      },
    );
  });
}

function runConcurrent(items, limit, worker) {
  return new Promise((resolve) => {
    if (!items.length) {
      resolve([]);
      return;
    }
    const results = new Array(items.length);
    let cursor = 0;
    let active = 0;

    const pump = () => {
      if (cursor >= items.length && active === 0) {
        resolve(results.filter(Boolean));
        return;
      }
      while (active < limit && cursor < items.length) {
        const index = cursor++;
        active += 1;
        Promise.resolve(worker(items[index]))
          .then((result) => { results[index] = result; })
          .catch((error) => {
            results[index] = { ...items[index], ok: false, mbps: 0, error: String(error) };
          })
          .finally(() => {
            active -= 1;
            pump();
          });
      }
    };
    pump();
  });
}

function sortResults(results) {
  return results
    .filter((item) => item && item.ok && item.mbps > 0)
    .sort((a, b) => b.mbps - a.mbps || a.elapsed - b.elapsed);
}

function dedupeResults(stage1, stage2) {
  const map = new Map();
  for (const item of stage1) map.set(item.node, { ...item, stage: 1 });
  for (const item of stage2) map.set(item.node, { ...item, stage: 2 });
  return sortResults([...map.values()]);
}

function formatResultLine(item, index) {
  return `${index + 1}. ${item.node} — ${item.mbps.toFixed(1)} Mbps (${item.region})`;
}

function notifyRanking(entry) {
  const ranking = Array.isArray(entry.ranking) ? entry.ranking : [];
  const top = ranking.slice(0, 5);
  const body = top.length
    ? top.map(formatResultLine).join("\n")
    : `最快节点：${entry.best}`;
  const full = ranking.length
    ? ranking.map(formatResultLine).join("\n")
    : `1. ${entry.best}`;

  try {
    $notification.post(
      "📺 BiliBili CDN 自动测速完成",
      `${entry.bestMbps.toFixed(1)} Mbps · ${entry.bestRegion || "未知地区"}`,
      body,
      { clipboard: full },
    );
  } catch (_) {
    $notification.post("📺 BiliBili CDN 自动测速完成", entry.best, body);
  }
}

async function runAutoSpeedTest(sampleUrl) {
  const data = await loadCcbData();
  const stage1Items = [];

  for (const [region, rawNodes] of Object.entries(data)) {
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];
    const node = regionPreferredNode(region, nodes);
    if (node) stage1Items.push({ region, node });
  }

  console.log(`[BiliBili Redirect] 自动测速第一阶段：${stage1Items.length} 个地区代表节点`);
  const stage1 = await runConcurrent(
    stage1Items,
    STAGE1_CONCURRENCY,
    (item) => probeNode(item, sampleUrl, STAGE1_BYTES, STAGE1_TIMEOUT_MS),
  );
  const stage1Ok = sortResults(stage1);

  if (!stage1Ok.length) {
    throw new Error("没有可用的第一阶段测速结果");
  }

  const topRegions = [];
  for (const item of stage1Ok) {
    if (!topRegions.includes(item.region)) topRegions.push(item.region);
    if (topRegions.length >= FINAL_REGION_COUNT) break;
  }

  const stage2Items = [];
  for (const region of topRegions) {
    const nodes = Array.isArray(data[region]) ? data[region] : [];
    const rep = stage1Ok.find((item) => item.region === region);
    for (const node of pickDiverseNodes(region, nodes, rep && rep.node, FINAL_NODES_PER_REGION)) {
      stage2Items.push({ region, node });
    }
  }

  console.log(`[BiliBili Redirect] 自动测速第二阶段：${topRegions.join(" / ")}，共 ${stage2Items.length} 个候选节点`);
  const stage2 = await runConcurrent(
    stage2Items,
    STAGE2_CONCURRENCY,
    (item) => probeNode(item, sampleUrl, STAGE2_BYTES, STAGE2_TIMEOUT_MS),
  );

  const finalRanking = sortResults(stage2);
  const ranking = dedupeResults(stage1, stage2);
  const best = finalRanking[0] || stage1Ok[0];
  if (!best) throw new Error("测速未找到可用节点");

  const entry = {
    version: 1,
    at: Date.now(),
    network: networkKey(),
    best: best.node,
    bestMbps: best.mbps,
    bestRegion: best.region,
    sampleHost: (() => {
      try { return new URL(sampleUrl).hostname; } catch (_) { return ""; }
    })(),
    ranking: ranking.map((item) => ({
      node: item.node,
      region: item.region,
      mbps: Number(item.mbps.toFixed(3)),
      elapsed: item.elapsed,
      bytes: item.bytes,
      status: item.status,
      stage: item.stage,
    })),
  };
  saveRanking(entry);
  notifyRanking(entry);
  console.log(`[BiliBili Redirect] 自动测速最快节点：${entry.best} (${entry.bestMbps.toFixed(1)} Mbps)`);
  return entry;
}

(async () => {
  if (getHeader($request.headers, AUTO_HEADER)) {
    $done({});
    return;
  }

  const cdn = $argument && $argument.cdn;
  const auto = isAutoEnabled($argument && $argument.auto);

  if (!auto) {
    if (typeof cdn !== "string" || cdn.length === 0 || isSeparator(cdn)) {
      console.log(
        isSeparator(cdn)
          ? "[BiliBili Redirect] 选择了地区分隔项，保留原请求"
          : "[BiliBili Redirect] 未收到 cdn 插件参数，保留原请求",
      );
      $done({});
      return;
    }
    rewriteRequest(cdn);
    return;
  }

  const cached = loadCachedRanking();
  if (cached) {
    console.log(`[BiliBili Redirect] 使用自动测速缓存：${cached.best} (${cached.bestMbps.toFixed(1)} Mbps)`);
    rewriteRequest(cached.best);
    return;
  }

  const lockToken = acquireTestLock();
  if (!lockToken) {
    console.log("[BiliBili Redirect] 已有测速任务运行，本请求临时使用手动回退节点");
    if (typeof cdn === "string" && cdn.length > 0 && !isSeparator(cdn)) rewriteRequest(cdn);
    else $done({});
    return;
  }

  try {
    console.log("[BiliBili Redirect] 无有效测速缓存，开始真实视频分片吞吐测速");
    const result = await runAutoSpeedTest($request.url);
    releaseTestLock(lockToken);
    rewriteRequest(result.best);
  } catch (error) {
    releaseTestLock(lockToken);
    console.log(`[BiliBili Redirect] 自动测速失败：${error}`);
    if (typeof cdn === "string" && cdn.length > 0 && !isSeparator(cdn)) {
      console.log(`[BiliBili Redirect] 回退到手动节点：${cdn}`);
      rewriteRequest(cdn);
    } else {
      $done({});
    }
  }
})().catch((error) => {
  console.log(`[BiliBili Redirect] 未处理异常：${error}`);
  $done({});
});

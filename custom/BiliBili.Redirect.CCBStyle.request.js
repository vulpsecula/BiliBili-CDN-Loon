const CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.v1";
const LOCK_KEY = "BiliBili.Redirect.CCBStyle.speed.lock.v1";
const STATUS_KEY = "BiliBili.Redirect.CCBStyle.status.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LOCK_TTL_MS = 15 * 1000;
const TEST_BUDGET_MS = 11500;
const AUTO_HEADER = "X-CCB-Speedtest";
const CCB_DATA_URLS = [
  "https://cdn.jsdelivr.net/gh/Kanda-Akihito-Kun/ccb@main/data/cdn.json",
  "https://raw.githubusercontent.com/Kanda-Akihito-Kun/ccb/main/data/cdn.json",
];
const CCB_FETCH_TIMEOUT_MS = 1200;

const STAGE1_BYTES = 128 * 1024;
const STAGE1_TIMEOUT_MS = 1100;
const STAGE1_CONCURRENCY = 12;
const STAGE2_BYTES = 512 * 1024;
const STAGE2_TIMEOUT_MS = 2200;
const STAGE2_CONCURRENCY = 6;
const FINAL_REGION_COUNT = 2;
const FINAL_NODES_PER_REGION = 3;

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

function args() {
  if ($argument && typeof $argument === "object") return $argument;
  const out = {};
  if (!$argument) return out;
  for (const pair of String($argument).split("&")) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    try {
      out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
    } catch (_) {}
  }
  return out;
}

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
    if (name.toLowerCase() === "host" || name.toLowerCase() === ":authority") headers[name] = cdn;
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

function readMap(key) {
  try {
    const raw = $persistentStore.read(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeMap(key, map, limit = 8) {
  const entries = Object.entries(map)
    .sort((a, b) => ((b[1] && b[1].at) || 0) - ((a[1] && a[1].at) || 0))
    .slice(0, limit);
  return $persistentStore.write(JSON.stringify(Object.fromEntries(entries)), key);
}

function writeStatus(state, extra = {}) {
  const key = networkKey();
  const map = readMap(STATUS_KEY);
  map[key] = { state, at: Date.now(), network: key, source: "cdn-request", ...extra };
  writeMap(STATUS_KEY, map, 8);
}

function loadCachedRanking() {
  const entry = readMap(CACHE_KEY)[networkKey()];
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.at !== "number" || Date.now() - entry.at > CACHE_TTL_MS) return null;
  if (typeof entry.best !== "string" || !entry.best) return null;
  return entry;
}

function saveRanking(entry) {
  const key = networkKey();
  const map = readMap(CACHE_KEY);
  map[key] = entry;
  writeMap(CACHE_KEY, map, 8);
}

function acquireLock() {
  const key = networkKey();
  let staleAge = 0;
  try {
    const current = JSON.parse($persistentStore.read(LOCK_KEY) || "null");
    if (current && current.network === key && typeof current.at === "number") {
      const age = Date.now() - current.at;
      if (current.token && age < LOCK_TTL_MS) return null;
      if (current.token && age >= LOCK_TTL_MS) staleAge = age;
    }
  } catch (_) {}

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  $persistentStore.write(JSON.stringify({ network: key, at: Date.now(), token }), LOCK_KEY);
  try {
    const current = JSON.parse($persistentStore.read(LOCK_KEY) || "null");
    if (!current || current.token !== token) return null;
  } catch (_) {}
  return { token, staleAge };
}

function releaseLock(token) {
  if (!token) return;
  try {
    const current = JSON.parse($persistentStore.read(LOCK_KEY) || "null");
    if (current && current.token === token) {
      $persistentStore.write(JSON.stringify({ network: current.network, at: 0, token: "" }), LOCK_KEY);
    }
  } catch (_) {}
}

function hardHttpGet(params, hardTimeout, callback) {
  let settled = false;
  const finish = (error, response, data) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    callback(error, response, data);
  };
  const timer = setTimeout(() => finish(`hard timeout ${hardTimeout}ms`, null, null), hardTimeout + 100);
  try {
    $httpClient.get({ ...params, timeout: hardTimeout }, (error, response, data) => finish(error, response, data));
  } catch (error) {
    finish(error, null, null);
  }
}

function fetchJson(url, timeout = CCB_FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    hardHttpGet(
      { url, "auto-cookie": false, headers: { "Cache-Control": "no-cache" } },
      timeout,
      (error, response, data) => {
        if (error || !response || response.status < 200 || response.status >= 300) {
          reject(new Error(error || `HTTP ${response && response.status}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      },
    );
  });
}

async function loadCcbData(deadlineAt) {
  for (const url of CCB_DATA_URLS) {
    const remaining = deadlineAt - Date.now();
    if (remaining < 600) break;
    try {
      const data = await fetchJson(url, Math.min(CCB_FETCH_TIMEOUT_MS, Math.max(500, remaining - 250)));
      if (data && typeof data === "object" && Object.keys(data).length > 0) return data;
    } catch (error) {
      console.log(`[BiliBili Redirect] 获取 CCB 节点失败: ${url} (${error})`);
    }
  }
  console.log("[BiliBili Redirect] CCB 在线数据不可用或预算不足，使用内置快速候选");
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
  const push = (node) => { if (node && safe.includes(node) && !ordered.includes(node)) ordered.push(node); };
  push(preferredNode);
  if (region === "海外") {
    ["upos-sz-mirrorcosov.bilivideo.com", "upos-sz-mirroraliov.bilivideo.com", "upos-sz-mirror08h.bilivideo.com"].forEach(push);
  } else if (region === "深圳") {
    ["upos-sz-mirrorcos.bilivideo.com", "upos-sz-mirrorali.bilivideo.com", "upos-sz-mirrorhw.bilivideo.com", "upos-sz-mirror08c.bilivideo.com"].forEach(push);
  }
  for (const isp of ["ct", "cu", "cm", "other"]) push(safe.find((node) => detectIsp(node) === isp));
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

function probeNode(item, sampleUrl, rangeBytes, timeout, deadlineAt) {
  return new Promise((resolve) => {
    const remaining = deadlineAt - Date.now();
    if (remaining < 250) {
      resolve({ ...item, ok: false, mbps: 0, bytes: 0, elapsed: 0, status: 0, error: "test budget exhausted" });
      return;
    }
    const effectiveTimeout = Math.max(200, Math.min(timeout, remaining - 100));
    const url = sampleUrlForNode(sampleUrl, item.node);
    if (!url) {
      resolve({ ...item, ok: false, mbps: 0, bytes: 0, elapsed: 0, status: 0 });
      return;
    }
    const started = Date.now();
    hardHttpGet(
      {
        url,
        headers: probeHeaders(rangeBytes),
        "binary-mode": true,
        "auto-redirect": false,
        "auto-cookie": false,
        alpn: "h2",
      },
      effectiveTimeout,
      (error, response, data) => {
        const elapsed = Math.max(1, Date.now() - started);
        const bytes = binaryLength(data);
        const status = response && response.status ? response.status : 0;
        const acceptedStatus = status === 206 || (status === 200 && bytes > 0 && bytes <= rangeBytes * 1.25);
        const ok = !error && acceptedStatus && bytes > 0;
        const mbps = ok ? (bytes * 8 / 1e6) / (elapsed / 1000) : 0;
        resolve({ ...item, ok, mbps, bytes, elapsed, status, error: error ? String(error) : null });
      },
    );
  });
}

function runConcurrent(items, limit, worker) {
  return new Promise((resolve) => {
    if (!items.length) { resolve([]); return; }
    const results = new Array(items.length);
    let cursor = 0;
    let active = 0;
    const pump = () => {
      if (cursor >= items.length && active === 0) { resolve(results.filter(Boolean)); return; }
      while (active < limit && cursor < items.length) {
        const index = cursor++;
        active += 1;
        Promise.resolve(worker(items[index]))
          .then((result) => { results[index] = result; })
          .catch((error) => { results[index] = { ...items[index], ok: false, mbps: 0, error: String(error) }; })
          .finally(() => { active -= 1; pump(); });
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
  return [...map.values()]
    .filter((item) => item && item.ok && item.mbps > 0)
    .sort((a, b) => b.stage - a.stage || b.mbps - a.mbps || a.elapsed - b.elapsed);
}

function formatResultLine(item, index) {
  const stage = item.stage === 2 ? "精测" : "初筛";
  return `${index + 1}. ${item.node} — ${item.mbps.toFixed(1)} Mbps (${item.region} · ${stage})`;
}

function notifyRanking(entry) {
  const top = (entry.ranking || []).slice(0, 5);
  const body = top.length ? top.map(formatResultLine).join("\n") : `最快节点：${entry.best}`;
  const full = (entry.ranking || []).length ? entry.ranking.map(formatResultLine).join("\n") : body;
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

async function runAutoSpeedTest(sampleUrl, startedAt, cdn, requestHost) {
  const deadlineAt = startedAt + TEST_BUDGET_MS;
  const data = await loadCcbData(deadlineAt);
  const stage1Items = [];
  for (const [region, rawNodes] of Object.entries(data)) {
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];
    const node = regionPreferredNode(region, nodes);
    if (node) stage1Items.push({ region, node });
  }

  writeStatus("testing", {
    auto: true,
    cdn,
    phase: "初筛",
    startedAt,
    sampleHost: requestHost,
    requestHost,
    message: `快速模式第一阶段：${stage1Items.length} 个地区代表节点，硬预算 ${Math.round(TEST_BUDGET_MS / 1000)} 秒`,
  });
  console.log(`[BiliBili Redirect] CDN fallback 快速初筛：${stage1Items.length} 个地区代表节点`);
  const stage1 = await runConcurrent(
    stage1Items,
    STAGE1_CONCURRENCY,
    (item) => probeNode(item, sampleUrl, STAGE1_BYTES, STAGE1_TIMEOUT_MS, deadlineAt),
  );
  const stage1Ok = sortResults(stage1);
  if (!stage1Ok.length) throw new Error(`快速初筛无可用结果（${stage1Items.length} 个候选均失败或超时）`);

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

  writeStatus("testing", {
    auto: true,
    cdn,
    phase: "精测",
    startedAt,
    sampleHost: requestHost,
    requestHost,
    message: `初筛成功 ${stage1Ok.length}/${stage1Items.length}；精测 ${topRegions.join(" / ")}，共 ${stage2Items.length} 个节点`,
  });
  console.log(`[BiliBili Redirect] CDN fallback 快速精测：${topRegions.join(" / ")}，共 ${stage2Items.length} 个候选节点`);

  let stage2 = [];
  if (deadlineAt - Date.now() > 500 && stage2Items.length) {
    stage2 = await runConcurrent(
      stage2Items,
      STAGE2_CONCURRENCY,
      (item) => probeNode(item, sampleUrl, STAGE2_BYTES, STAGE2_TIMEOUT_MS, deadlineAt),
    );
  }

  const finalRanking = sortResults(stage2);
  const ranking = dedupeResults(stage1, stage2);
  const best = finalRanking[0] || stage1Ok[0];
  if (!best) throw new Error("测速未找到可用节点");

  const entry = {
    version: 3,
    at: Date.now(),
    network: networkKey(),
    source: "cdn-request",
    best: best.node,
    bestMbps: best.mbps,
    bestRegion: best.region,
    sampleHost: requestHost,
    elapsedMs: Date.now() - startedAt,
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
  return entry;
}

(async () => {
  if (getHeader($request.headers, AUTO_HEADER)) {
    $done({});
    return;
  }

  const options = args();
  const cdn = options.cdn;
  const auto = isAutoEnabled(options.auto);
  let requestHost = "";
  try { requestHost = new URL($request.url).hostname; } catch (_) {}

  if (!auto) {
    if (typeof cdn !== "string" || !cdn || isSeparator(cdn)) {
      writeStatus("error", { auto, cdn, message: "手动 CDN 无效或选中了地区分隔项", requestHost });
      $done({});
      return;
    }
    writeStatus("manual", { auto, cdn, selected: cdn, requestHost });
    rewriteRequest(cdn);
    return;
  }

  const cached = loadCachedRanking();
  if (cached) {
    writeStatus("cached", {
      auto,
      cdn,
      selected: cached.best,
      bestMbps: cached.bestMbps,
      bestRegion: cached.bestRegion,
      requestHost,
    });
    console.log(`[BiliBili Redirect] CDN fallback 使用测速缓存：${cached.best} (${Number(cached.bestMbps || 0).toFixed(1)} Mbps)`);
    rewriteRequest(cached.best);
    return;
  }

  const lock = acquireLock();
  if (!lock) {
    // Do not overwrite the active task's status/timestamp. Concurrent video chunks should not make a stuck test look freshly started.
    console.log("[BiliBili Redirect] 已有测速任务运行，本请求临时使用手动 CDN");
    if (typeof cdn === "string" && cdn && !isSeparator(cdn)) rewriteRequest(cdn);
    else $done({});
    return;
  }

  const startedAt = Date.now();
  try {
    writeStatus("testing", {
      auto,
      cdn,
      phase: "准备",
      startedAt,
      sampleHost: requestHost,
      requestHost,
      message: lock.staleAge > 0
        ? `检测到上一轮测速超过 ${Math.round(lock.staleAge / 1000)} 秒未完成，已切换为硬截止快速模式重试`
        : "未命中可用 playurl 缓存，已由 CDN 请求 fallback 启动快速两阶段测速",
    });
    const entry = await runAutoSpeedTest($request.url, startedAt, cdn, requestHost);
    releaseLock(lock.token);
    writeStatus("success", {
      auto,
      cdn,
      selected: entry.best,
      bestMbps: entry.bestMbps,
      bestRegion: entry.bestRegion,
      elapsedMs: entry.elapsedMs,
      requestHost,
      message: `测速在 ${(entry.elapsedMs / 1000).toFixed(1)} 秒内完成`,
    });
    rewriteRequest(entry.best);
  } catch (error) {
    releaseLock(lock.token);
    const message = String(error);
    writeStatus("error", {
      auto,
      cdn,
      startedAt,
      elapsedMs: Date.now() - startedAt,
      message,
      requestHost,
    });
    console.log(`[BiliBili Redirect] CDN fallback 自动测速失败：${message}`);
    if (typeof cdn === "string" && cdn && !isSeparator(cdn)) {
      console.log(`[BiliBili Redirect] 回退到手动节点：${cdn}`);
      rewriteRequest(cdn);
    } else {
      $done({});
    }
  }
})().catch((error) => {
  writeStatus("error", { message: `未处理异常: ${error}` });
  console.log(`[BiliBili Redirect] CDN request 未处理异常：${error}`);
  $done({});
});

const CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.v1";
const LOCK_KEY = "BiliBili.Redirect.CCBStyle.speed.lock.v1";
const STATUS_KEY = "BiliBili.Redirect.CCBStyle.status.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LOCK_TTL_MS = 30 * 1000;
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

function isAutoEnabled(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function isSeparator(value) {
  return typeof value === "string" && /^─{2,}.*─{2,}$/.test(value.trim());
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
  map[key] = {
    state,
    at: Date.now(),
    network: key,
    source: "playurl-response",
    ...extra,
  };
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
  try {
    const current = JSON.parse($persistentStore.read(LOCK_KEY) || "null");
    if (current && current.network === key && typeof current.at === "number" && Date.now() - current.at < LOCK_TTL_MS) {
      return null;
    }
  } catch (_) {}

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  $persistentStore.write(JSON.stringify({ network: key, at: Date.now(), token }), LOCK_KEY);
  try {
    const current = JSON.parse($persistentStore.read(LOCK_KEY) || "null");
    return current && current.token === token ? token : null;
  } catch (_) {
    return token;
  }
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

function getHeader(headers, wanted) {
  if (!headers || typeof headers !== "object") return undefined;
  const key = Object.keys(headers).find((name) => name.toLowerCase() === wanted.toLowerCase());
  return key ? headers[key] : undefined;
}

function fetchJson(url, timeout = 2500) {
  return new Promise((resolve, reject) => {
    $httpClient.get(
      { url, timeout, "auto-cookie": false, headers: { "Cache-Control": "no-cache" } },
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
    "X-CCB-Speedtest": "1",
  };
  const ua = getHeader($request && $request.headers, "user-agent");
  if (ua) headers["User-Agent"] = ua;
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
        resolve({ ...item, ok, mbps, bytes, elapsed, status, error: error ? String(error) : null });
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

async function runAutoSpeedTest(sampleUrl) {
  const data = await loadCcbData();
  const stage1Items = [];
  for (const [region, rawNodes] of Object.entries(data)) {
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];
    const node = regionPreferredNode(region, nodes);
    if (node) stage1Items.push({ region, node });
  }
  console.log(`[BiliBili Redirect] playurl 自动测速第一阶段：${stage1Items.length} 个地区代表节点`);
  const stage1 = await runConcurrent(
    stage1Items,
    STAGE1_CONCURRENCY,
    (item) => probeNode(item, sampleUrl, STAGE1_BYTES, STAGE1_TIMEOUT_MS),
  );
  const stage1Ok = sortResults(stage1);
  if (!stage1Ok.length) throw new Error("第一阶段没有可用测速结果");

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
  console.log(`[BiliBili Redirect] playurl 自动测速第二阶段：${topRegions.join(" / ")}，共 ${stage2Items.length} 个候选节点`);
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
    version: 2,
    at: Date.now(),
    network: networkKey(),
    source: "playurl-response",
    best: best.node,
    bestMbps: best.mbps,
    bestRegion: best.region,
    sampleHost: (() => { try { return new URL(sampleUrl).hostname; } catch (_) { return ""; } })(),
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

function rewriteMediaUrl(raw, cdn) {
  if (typeof raw !== "string" || !/^https?:\/\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    url.protocol = "https:";
    url.hostname = cdn;
    url.port = "";
    return url.toString();
  } catch (_) {
    return raw;
  }
}

function processMediaPayload(payload, targetCdn) {
  let sampleUrl = null;
  let changed = 0;
  const seenContainers = new Set();

  const remember = (url) => {
    if (!sampleUrl && typeof url === "string" && /^https?:\/\//i.test(url)) sampleUrl = url;
  };

  const rewriteField = (object, key) => {
    if (!object || typeof object !== "object" || !(key in object)) return;
    const value = object[key];
    if (typeof value === "string") {
      remember(value);
      if (targetCdn) {
        const next = rewriteMediaUrl(value, targetCdn);
        if (next !== value) { object[key] = next; changed += 1; }
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item !== "string") return;
        remember(item);
        if (targetCdn) {
          const next = rewriteMediaUrl(item, targetCdn);
          if (next !== item) { value[index] = next; changed += 1; }
        }
      });
    }
  };

  const processStream = (stream) => {
    if (!stream || typeof stream !== "object") return;
    for (const key of ["baseUrl", "base_url", "backupUrl", "backup_url"]) rewriteField(stream, key);
  };

  const processDash = (dash) => {
    if (!dash || typeof dash !== "object" || seenContainers.has(dash)) return;
    seenContainers.add(dash);
    if (Array.isArray(dash.video)) dash.video.forEach(processStream);
    if (Array.isArray(dash.audio)) dash.audio.forEach(processStream);
    if (dash.dolby && Array.isArray(dash.dolby.audio)) dash.dolby.audio.forEach(processStream);
    if (dash.flac && dash.flac.audio) processStream(dash.flac.audio);
  };

  const processDurl = (durl) => {
    if (!Array.isArray(durl) || seenContainers.has(durl)) return;
    seenContainers.add(durl);
    for (const item of durl) {
      if (!item || typeof item !== "object") continue;
      for (const key of ["url", "backup_url", "backupUrl"]) rewriteField(item, key);
    }
  };

  const walk = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 8) return;
    if (value.dash) processDash(value.dash);
    if (value.durl) processDurl(value.durl);
    for (const [key, child] of Object.entries(value)) {
      if (key === "dash" || key === "durl") continue;
      if (child && typeof child === "object") walk(child, depth + 1);
    }
  };

  walk(payload);
  return { sampleUrl, changed };
}

(async () => {
  const options = args();
  const cdn = options.cdn;
  const auto = isAutoEnabled(options.auto);
  const requestUrl = ($request && $request.url) || "";
  console.log(`[BiliBili Redirect] playurl response 命中: ${requestUrl}`);

  if (!$response || typeof $response.body !== "string" || !$response.body) {
    writeStatus("error", { auto, cdn, message: "playurl 响应没有可读取的 JSON body", requestUrl });
    $done({});
    return;
  }

  let payload;
  try {
    payload = JSON.parse($response.body);
  } catch (error) {
    writeStatus("error", { auto, cdn, message: `playurl JSON 解析失败: ${error}`, requestUrl });
    $done({});
    return;
  }

  const initial = processMediaPayload(payload, null);
  if (!initial.sampleUrl) {
    writeStatus("waiting", { auto, cdn, message: "playurl 已命中，但响应中没有找到 DASH/durl 媒体 URL", requestUrl });
    console.log("[BiliBili Redirect] playurl 响应中未找到可测速媒体 URL，保留原响应");
    $done({});
    return;
  }

  if (!auto) {
    if (typeof cdn !== "string" || !cdn || isSeparator(cdn)) {
      writeStatus("error", { auto, cdn, message: "手动 CDN 无效或选中了地区分隔项", requestUrl });
      $done({});
      return;
    }
    const result = processMediaPayload(payload, cdn);
    writeStatus("manual", { auto, cdn, selected: cdn, changed: result.changed, requestUrl });
    console.log(`[BiliBili Redirect] playurl 手动改写 ${result.changed} 条媒体 URL -> ${cdn}`);
    $done({ body: JSON.stringify(payload) });
    return;
  }

  const cached = loadCachedRanking();
  if (cached) {
    const result = processMediaPayload(payload, cached.best);
    writeStatus("cached", {
      auto,
      cdn,
      selected: cached.best,
      bestMbps: cached.bestMbps,
      bestRegion: cached.bestRegion,
      changed: result.changed,
      requestUrl,
    });
    console.log(`[BiliBili Redirect] playurl 使用测速缓存 ${cached.best} (${Number(cached.bestMbps || 0).toFixed(1)} Mbps)`);
    $done({ body: JSON.stringify(payload) });
    return;
  }

  const lockToken = acquireLock();
  if (!lockToken) {
    writeStatus("testing", { auto, cdn, message: "已有测速任务运行，本次 playurl 临时使用手动 CDN", requestUrl });
    if (typeof cdn === "string" && cdn && !isSeparator(cdn)) {
      processMediaPayload(payload, cdn);
      $done({ body: JSON.stringify(payload) });
    } else {
      $done({});
    }
    return;
  }

  try {
    writeStatus("testing", {
      auto,
      cdn,
      message: "已从 playurl 获取真实视频 URL，正在进行两阶段吞吐测速",
      sampleHost: new URL(initial.sampleUrl).hostname,
      requestUrl,
    });
    const entry = await runAutoSpeedTest(initial.sampleUrl);
    releaseLock(lockToken);
    const result = processMediaPayload(payload, entry.best);
    writeStatus("success", {
      auto,
      cdn,
      selected: entry.best,
      bestMbps: entry.bestMbps,
      bestRegion: entry.bestRegion,
      changed: result.changed,
      requestUrl,
    });
    console.log(`[BiliBili Redirect] playurl 自动改写 ${result.changed} 条媒体 URL -> ${entry.best}`);
    $done({ body: JSON.stringify(payload) });
  } catch (error) {
    releaseLock(lockToken);
    const message = String(error);
    writeStatus("error", { auto, cdn, message, requestUrl });
    console.log(`[BiliBili Redirect] playurl 自动测速失败：${message}`);
    if (typeof cdn === "string" && cdn && !isSeparator(cdn)) {
      processMediaPayload(payload, cdn);
      console.log(`[BiliBili Redirect] playurl 回退手动 CDN：${cdn}`);
      $done({ body: JSON.stringify(payload) });
    } else {
      $done({});
    }
  }
})().catch((error) => {
  writeStatus("error", { message: `未处理异常: ${error}` });
  console.log(`[BiliBili Redirect] playurl 未处理异常：${error}`);
  $done({});
});

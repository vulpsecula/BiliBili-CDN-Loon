const CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.v1";
const LOCK_KEY = "BiliBili.Redirect.CCBStyle.speed.lock.v1";
const STATUS_KEY = "BiliBili.Redirect.CCBStyle.status.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LOCK_TTL_MS = 15 * 1000;
const TEST_BUDGET_MS = 11500;
const POOL_VERSION = 4;

const STAGE1_BYTES = 128 * 1024;
const STAGE1_TIMEOUT_MS = 1400;
const STAGE1_CONCURRENCY = 12;
const STAGE2_BYTES = 512 * 1024;
const STAGE2_TIMEOUT_MS = 2400;
const STAGE2_CONCURRENCY = 6;
const FINAL_REGION_COUNT = 3;
const FINAL_NODES_PER_REGION = 3;

const CCB_REGION_POOL = {
  "上海": ["cn-sh-ct-01-01.bilivideo.com", "cn-sh-ct-01-13.bilivideo.com", "cn-sh-ct-01-35.bilivideo.com"],
  "内蒙": ["cn-nmghhht-cm-01-11.bilivideo.com", "cn-nmghhht-cu-01-01.bilivideo.com", "cn-nmghhht-cu-01-10.bilivideo.com"],
  "北京": ["cn-bj-cc-03-14.bilivideo.com", "cn-bj-fx-01-04.bilivideo.com", "cn-bj-se-01-03.bilivideo.com"],
  "四川": ["cn-sccd-cm-03-01.bilivideo.com", "cn-sccd-ct-01-02.bilivideo.com", "cn-sccd-cu-01-01.bilivideo.com"],
  "外建": ["d1--cn-gotcha04.bilivideo.com", "d1--cn-gotcha09.bilivideo.com", "d1--ov-gotcha01.bilivideo.com"],
  "天津": ["cn-tj-cm-02-01.bilivideo.com", "cn-tj-cu-01-01.bilivideo.com", "cn-tj-fx-01-01.bilivideo.com"],
  "山东": ["cn-sdjn-cm-02-01.bilivideo.com", "cn-sdjn-fx-01-01.bilivideo.com", "cn-sdqd-cu-01-01.bilivideo.com"],
  "山西": ["cn-sxty-cm-02-04.bilivideo.com", "cn-sxty-cu-03-01.bilivideo.com", "cn-sxty-cu-03-09.bilivideo.com"],
  "广东": ["cn-gddg-cm-01-02.bilivideo.com", "cn-gddg-ct-01-10.bilivideo.com", "cn-gddg-cu-01-04.bilivideo.com"],
  "新疆": ["cn-xj-cm-02-01.bilivideo.com", "cn-xj-ct-01-01.bilivideo.com", "cn-xj-ct-02-02.bilivideo.com"],
  "江苏": ["cn-jsnj-fx-02-05.bilivideo.com", "cn-jsnj-gd-01-02.bilivideo.com", "cn-jssz-cm-02-07.bilivideo.com"],
  "江西": ["cn-jxjj-ct-01-01.bilivideo.com", "cn-jxnc-cm-01-04.bilivideo.com", "cn-jxnc-cmcc-bcache-06.bilivideo.com"],
  "河北": ["cn-hblf-ct-01-06.bilivideo.com", "cn-hbsjz-cm-02-01.bilivideo.com", "cn-hbsjz-cm-02-14.bilivideo.com"],
  "河南": ["cn-hnzz-cm-01-01.bilivideo.com", "cn-hnzz-fx-01-01.bilivideo.com", "cn-hnzz-cm-01-16.bilivideo.com"],
  "浙江": ["cn-zjhz-cm-01-01.bilivideo.com", "cn-zjhz-cu-01-01.bilivideo.com", "cn-zjjh-ct-04-03.bilivideo.com"],
  "海外": ["upos-sz-mirrorcosov.bilivideo.com", "upos-sz-mirroraliov.bilivideo.com", "upos-sz-mirror08h.bilivideo.com"],
  "深圳": ["upos-sz-estgcos.bilivideo.com", "upos-sz-mirrorcos.bilivideo.com", "upos-sz-mirrorali.bilivideo.com", "upos-sz-mirrorhw.bilivideo.com"],
  "湖北": ["cn-hbwh-cm-01-01.bilivideo.com", "cn-hbwh-fx-01-01.bilivideo.com", "cn-hbyc-ct-02-02.bilivideo.com"],
  "湖南": ["cn-hncs-cm-03-01.bilivideo.com", "cn-hncs-cu-01-01.bilivideo.com", "cn-hncs-fx-01-01.bilivideo.com"],
  "福建": ["cn-fjfz-fx-01-01.bilivideo.com", "cn-fjqz-cm-01-01.bilivideo.com", "cn-fjqz-cm-01-09.bilivideo.com"],
  "辽宁": ["cn-lndl-ct-01-01.bilivideo.com", "cn-lnsy-cm-01-01.bilivideo.com", "cn-lnsy-cu-01-01.bilivideo.com"],
  "重庆": ["cn-cq-cm-01-01.bilivideo.com", "cn-cq-ct-01-05.bilivideo.com", "cn-cq-ct-01-24.bilivideo.com"],
  "陕西": ["cn-sxxa-cm-01-01.bilivideo.com", "cn-sxxa-ct-03-02.bilivideo.com", "cn-sxxa-cu-02-01.bilivideo.com"],
  "香港": ["cn-hk-eq-01-01.bilivideo.com", "cn-hk-eq-01-08.bilivideo.com", "cn-hk-eq-01-13.bilivideo.com"],
  "黑省": ["cn-hljheb-cm-01-01.bilivideo.com", "cn-hljheb-ct-01-02.bilivideo.com", "cn-hljheb-ct-01-07.bilivideo.com"],
};

function args() {
  if ($argument && typeof $argument === "object") return $argument;
  const out = {};
  if (!$argument) return out;
  for (const pair of String($argument).split("&")) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    try { out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1)); } catch (_) {}
  }
  return out;
}

function isAutoEnabled(value) { return value === true || value === "true" || value === 1 || value === "1"; }
function isSeparator(value) { return typeof value === "string" && /^─{2,}.*─{2,}$/.test(value.trim()); }

function networkKey() {
  try {
    const config = JSON.parse($config.getConfig());
    const ssid = config && config.ssid ? String(config.ssid) : "cellular-or-unknown";
    const mode = config && config.running_model !== undefined ? String(config.running_model) : "unknown";
    return `${ssid}|mode=${mode}`;
  } catch (_) { return "unknown"; }
}

function readMap(key) {
  try {
    const raw = $persistentStore.read(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) { return {}; }
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
  map[key] = { state, at: Date.now(), network: key, source: "playurl-response", ...extra };
  writeMap(STATUS_KEY, map, 8);
}

function loadCachedRanking() {
  const key = networkKey();
  const map = readMap(CACHE_KEY);
  const entry = map[key];
  if (!entry || typeof entry !== "object") return null;
  if (entry.poolVersion !== POOL_VERSION) {
    delete map[key];
    writeMap(CACHE_KEY, map, 8);
    return null;
  }
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
    if (current && current.network === key && current.token && typeof current.at === "number" && Date.now() - current.at < LOCK_TTL_MS) return null;
  } catch (_) {}
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  $persistentStore.write(JSON.stringify({ network: key, at: Date.now(), token }), LOCK_KEY);
  try {
    const current = JSON.parse($persistentStore.read(LOCK_KEY) || "null");
    return current && current.token === token ? token : null;
  } catch (_) { return token; }
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

function hardHttpGet(params, hardTimeout, callback) {
  let settled = false;
  const finish = (error, response, data) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    callback(error, response, data);
  };
  const timer = setTimeout(() => finish(`hard timeout ${hardTimeout}ms`, null, null), hardTimeout + 100);
  try { $httpClient.get({ ...params, timeout: hardTimeout }, (error, response, data) => finish(error, response, data)); }
  catch (error) { finish(error, null, null); }
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
    "深圳": ["upos-sz-estgcos.bilivideo.com", "upos-sz-mirrorcos.bilivideo.com", "upos-sz-mirrorali.bilivideo.com"],
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
    ["upos-sz-estgcos.bilivideo.com", "upos-sz-mirrorcos.bilivideo.com", "upos-sz-mirrorali.bilivideo.com", "upos-sz-mirrorhw.bilivideo.com"].forEach(push);
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
  } catch (_) { return null; }
}

function probeHeaders(rangeBytes) {
  const headers = { Range: `bytes=0-${rangeBytes - 1}`, "Accept-Encoding": "identity", "X-CCB-Speedtest": "1" };
  const ua = getHeader($request && $request.headers, "user-agent");
  if (ua) headers["User-Agent"] = ua;
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
    hardHttpGet({
      url,
      headers: probeHeaders(rangeBytes),
      "binary-mode": true,
      "auto-redirect": false,
      "auto-cookie": false,
      alpn: "h2",
    }, effectiveTimeout, (error, response, data) => {
      const elapsed = Math.max(1, Date.now() - started);
      const bytes = binaryLength(data);
      const status = response && response.status ? response.status : 0;
      const acceptedStatus = status === 206 || (status === 200 && bytes > 0 && bytes <= rangeBytes * 1.25);
      const ok = !error && acceptedStatus && bytes > 0;
      const mbps = ok ? (bytes * 8 / 1e6) / (elapsed / 1000) : 0;
      resolve({ ...item, ok, mbps, bytes, elapsed, status, error: error ? String(error) : null });
    });
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
  return results.filter((item) => item && item.ok && item.mbps > 0)
    .sort((a, b) => b.mbps - a.mbps || a.elapsed - b.elapsed);
}

function dedupeResults(stage1, stage2) {
  const map = new Map();
  for (const item of stage1) map.set(item.node, { ...item, stage: 1 });
  for (const item of stage2) map.set(item.node, { ...item, stage: 2 });
  return [...map.values()].filter((item) => item && item.ok && item.mbps > 0)
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
    $notification.post("📺 BiliBili CDN 自动测速完成", `${entry.bestMbps.toFixed(1)} Mbps · ${entry.bestRegion || "未知地区"}`, body, { clipboard: full });
  } catch (_) { $notification.post("📺 BiliBili CDN 自动测速完成", entry.best, body); }
}

async function runAutoSpeedTest(sampleUrl, startedAt, cdn, sampleHost, requestUrl) {
  const deadlineAt = startedAt + TEST_BUDGET_MS;
  const data = CCB_REGION_POOL;
  const stage1Items = [];
  for (const [region, rawNodes] of Object.entries(data)) {
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];
    const node = regionPreferredNode(region, nodes);
    if (node) stage1Items.push({ region, node });
  }

  writeStatus("testing", {
    auto: true, cdn, phase: "初筛", startedAt, sampleHost, requestUrl,
    message: `playurl 内置 CCB 代表池初筛：${stage1Items.length} 个可测速地区`,
  });
  console.log(`[BiliBili Redirect] playurl 内置池初筛：${stage1Items.length} 个地区代表节点`);
  const stage1 = await runConcurrent(stage1Items, STAGE1_CONCURRENCY,
    (item) => probeNode(item, sampleUrl, STAGE1_BYTES, STAGE1_TIMEOUT_MS, deadlineAt));
  const stage1Ok = sortResults(stage1);
  if (!stage1Ok.length) throw new Error(`初筛无可用结果（${stage1Items.length} 个候选均失败或超时）`);

  const topRegions = [];
  for (const item of stage1Ok) {
    if (!topRegions.includes(item.region)) topRegions.push(item.region);
    if (topRegions.length >= FINAL_REGION_COUNT) break;
  }

  const stage2Items = [];
  for (const region of topRegions) {
    const nodes = Array.isArray(data[region]) ? data[region] : [];
    const rep = stage1Ok.find((item) => item.region === region);
    for (const node of pickDiverseNodes(region, nodes, rep && rep.node, FINAL_NODES_PER_REGION)) stage2Items.push({ region, node });
  }

  writeStatus("testing", {
    auto: true, cdn, phase: "精测", startedAt, sampleHost, requestUrl,
    message: `初筛成功 ${stage1Ok.length}/${stage1Items.length}；精测 ${topRegions.join(" / ")}，共 ${stage2Items.length} 个节点`,
  });
  console.log(`[BiliBili Redirect] playurl 内置池精测：${topRegions.join(" / ")}，共 ${stage2Items.length} 个候选节点`);

  let stage2 = [];
  if (deadlineAt - Date.now() > 500 && stage2Items.length) {
    stage2 = await runConcurrent(stage2Items, STAGE2_CONCURRENCY,
      (item) => probeNode(item, sampleUrl, STAGE2_BYTES, STAGE2_TIMEOUT_MS, deadlineAt));
  }

  const finalRanking = sortResults(stage2);
  const ranking = dedupeResults(stage1, stage2);
  const best = finalRanking[0] || stage1Ok[0];
  if (!best) throw new Error("测速未找到可用节点");

  const entry = {
    version: 4,
    poolVersion: POOL_VERSION,
    at: Date.now(),
    network: networkKey(),
    source: "playurl-response",
    best: best.node,
    bestMbps: best.mbps,
    bestRegion: best.region,
    sampleHost,
    elapsedMs: Date.now() - startedAt,
    ranking: ranking.map((item) => ({
      node: item.node, region: item.region, mbps: Number(item.mbps.toFixed(3)), elapsed: item.elapsed,
      bytes: item.bytes, status: item.status, stage: item.stage,
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
  } catch (_) { return raw; }
}

function processMediaPayload(payload, targetCdn) {
  let sampleUrl = null;
  let changed = 0;
  const seenContainers = new Set();
  const remember = (url) => { if (!sampleUrl && typeof url === "string" && /^https?:\/\//i.test(url)) sampleUrl = url; };
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
    $done({}); return;
  }

  let payload;
  try { payload = JSON.parse($response.body); }
  catch (error) {
    writeStatus("error", { auto, cdn, message: `playurl JSON 解析失败: ${error}`, requestUrl });
    $done({}); return;
  }

  const initial = processMediaPayload(payload, null);
  if (!initial.sampleUrl) {
    writeStatus("waiting", { auto, cdn, message: "playurl 已命中，但响应中没有找到 DASH/durl 媒体 URL", requestUrl });
    console.log("[BiliBili Redirect] playurl 响应中未找到可测速媒体 URL，保留原响应");
    $done({}); return;
  }

  if (!auto) {
    if (typeof cdn !== "string" || !cdn || isSeparator(cdn)) {
      writeStatus("error", { auto, cdn, message: "手动 CDN 无效或选中了地区分隔项", requestUrl });
      $done({}); return;
    }
    const result = processMediaPayload(payload, cdn);
    writeStatus("manual", { auto, cdn, selected: cdn, changed: result.changed, requestUrl });
    console.log(`[BiliBili Redirect] playurl 手动改写 ${result.changed} 条媒体 URL -> ${cdn}`);
    $done({ body: JSON.stringify(payload) }); return;
  }

  const cached = loadCachedRanking();
  if (cached) {
    const result = processMediaPayload(payload, cached.best);
    writeStatus("cached", { auto, cdn, selected: cached.best, bestMbps: cached.bestMbps, bestRegion: cached.bestRegion, changed: result.changed, requestUrl });
    console.log(`[BiliBili Redirect] playurl 使用测速缓存 ${cached.best} (${Number(cached.bestMbps || 0).toFixed(1)} Mbps)`);
    $done({ body: JSON.stringify(payload) }); return;
  }

  const lockToken = acquireLock();
  if (!lockToken) {
    console.log("[BiliBili Redirect] 已有测速任务运行，本次 playurl 临时使用手动 CDN");
    if (typeof cdn === "string" && cdn && !isSeparator(cdn)) {
      processMediaPayload(payload, cdn);
      $done({ body: JSON.stringify(payload) });
    } else $done({});
    return;
  }

  const startedAt = Date.now();
  let sampleHost = "";
  try { sampleHost = new URL(initial.sampleUrl).hostname; } catch (_) {}
  try {
    writeStatus("testing", {
      auto, cdn, phase: "准备", startedAt, sampleHost, requestUrl,
      message: "已从 playurl 获取真实视频 URL，使用内置 25 地区 CCB 代表池测速",
    });
    const entry = await runAutoSpeedTest(initial.sampleUrl, startedAt, cdn, sampleHost, requestUrl);
    releaseLock(lockToken);
    const result = processMediaPayload(payload, entry.best);
    writeStatus("success", {
      auto, cdn, selected: entry.best, bestMbps: entry.bestMbps, bestRegion: entry.bestRegion,
      elapsedMs: entry.elapsedMs, changed: result.changed, requestUrl,
      message: `内置池测速在 ${(entry.elapsedMs / 1000).toFixed(1)} 秒内完成`,
    });
    console.log(`[BiliBili Redirect] playurl 自动改写 ${result.changed} 条媒体 URL -> ${entry.best}`);
    $done({ body: JSON.stringify(payload) });
  } catch (error) {
    releaseLock(lockToken);
    const message = String(error);
    writeStatus("error", { auto, cdn, startedAt, elapsedMs: Date.now() - startedAt, message, requestUrl });
    console.log(`[BiliBili Redirect] playurl 自动测速失败：${message}`);
    if (typeof cdn === "string" && cdn && !isSeparator(cdn)) {
      processMediaPayload(payload, cdn);
      console.log(`[BiliBili Redirect] playurl 回退手动 CDN：${cdn}`);
      $done({ body: JSON.stringify(payload) });
    } else $done({});
  }
})().catch((error) => {
  writeStatus("error", { message: `未处理异常: ${error}` });
  console.log(`[BiliBili Redirect] playurl 未处理异常：${error}`);
  $done({});
});

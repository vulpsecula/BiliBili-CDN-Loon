const CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.v1";
const LOCK_KEY = "BiliBili.Redirect.CCBStyle.speed.lock.v1";
const STATUS_KEY = "BiliBili.Redirect.CCBStyle.status.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LOCK_TTL_MS = 20 * 1000;
const TEST_BUDGET_MS = 16000;
const POOL_VERSION = 5;
const ENGINE_VERSION = 7;
const AUTO_HEADER = "X-CCB-Speedtest";

const STAGE1_BYTES = 128 * 1024;
const STAGE1_TIMEOUT_MS = 4500;
const STAGE1_CONCURRENCY = 3;
const STAGE2_BYTES = 768 * 1024;
const STAGE2_TIMEOUT_MS = 5000;
const STAGE2_CONCURRENCY = 2;

// CDN-request fallback only has one signed media URL. Do not compare unrelated
// CDN families with that URL. The playurl-response script remains responsible
// for broad multi-family testing when multiple signed URLs are available.
const FAMILY_CANDIDATES = {
  cos: [
    { region: "深圳", node: "upos-sz-estgcos.bilivideo.com" },
    { region: "深圳", node: "upos-sz-mirrorcos.bilivideo.com" },
    { region: "海外", node: "upos-sz-mirrorcosov.bilivideo.com" },
  ],
  ali: [
    { region: "深圳", node: "upos-sz-mirrorali.bilivideo.com" },
    { region: "海外", node: "upos-sz-mirroraliov.bilivideo.com" },
  ],
  hw: [
    { region: "深圳", node: "upos-sz-mirrorhw.bilivideo.com" },
  ],
  "08": [
    { region: "海外", node: "upos-sz-mirror08h.bilivideo.com" },
  ],
  regional: [
    { region: "香港", node: "cn-hk-eq-01-01.bilivideo.com" },
    { region: "广东", node: "cn-gddg-ct-01-10.bilivideo.com" },
    { region: "上海", node: "cn-sh-ct-01-01.bilivideo.com" },
  ],
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

function isAutoEnabled(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function isSeparator(value) {
  return typeof value === "string" && /^─{2,}.*─{2,}$/.test(value.trim());
}

function getHeader(headers, wanted) {
  if (!headers || typeof headers !== "object") return undefined;
  const key = Object.keys(headers).find((name) => name.toLowerCase() === wanted.toLowerCase());
  return key ? headers[key] : undefined;
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

function classifyHostFamily(host) {
  const h = String(host || "").toLowerCase();
  if (!h) return "unknown";
  if (h.includes("akamaized.net") || h.includes("mirrorakam")) return "akamai";
  if (h.includes("estgcos") || h.includes("mirrorcos") || h.includes("staticcos")) return "cos";
  if (h.includes("mirrorali")) return "ali";
  if (h.includes("mirrorhw") || h.includes("estghw")) return "hw";
  if (h.includes("mirror08")) return "08";
  if (h.endsWith(".bilivideo.cn")) return "mcdn";
  if (h.startsWith("cn-") && h.endsWith(".bilivideo.com")) return "regional";
  return "generic";
}

function normalizeOsFamily(value) {
  const os = String(value || "").toLowerCase();
  if (!os) return "";
  if (os.startsWith("akam")) return "akamai";
  if (os.startsWith("cos")) return "cos";
  if (os.startsWith("ali")) return "ali";
  if (os.startsWith("hw")) return "hw";
  return "";
}

function describeSample(raw) {
  try {
    const url = new URL(raw);
    const hostFamily = classifyHostFamily(url.hostname);
    const osFamily = normalizeOsFamily(url.searchParams.get("os"));
    return {
      url: raw,
      host: url.hostname,
      hostFamily,
      signatureFamily: osFamily || hostFamily,
    };
  } catch (_) {
    return null;
  }
}

function loadCachedRanking(family) {
  const entry = readMap(CACHE_KEY)[networkKey()];
  if (!entry || typeof entry !== "object") return null;
  if (entry.poolVersion !== POOL_VERSION || entry.engineVersion !== ENGINE_VERSION) return null;
  if (typeof entry.at !== "number" || Date.now() - entry.at > CACHE_TTL_MS) return null;
  if (typeof entry.best !== "string" || !entry.best) return null;
  if (family && entry.probeFamily && entry.probeFamily !== family) return null;
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

function hardHttpGet(params, hardTimeout, callback) {
  let settled = false;
  const finish = (error, response, data) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    callback(error, response, data);
  };
  const timer = setTimeout(() => finish(`hard timeout ${hardTimeout}ms`, null, null), hardTimeout + 150);
  try {
    $httpClient.get({ ...params, timeout: hardTimeout }, (error, response, data) => finish(error, response, data));
  } catch (error) {
    finish(error, null, null);
  }
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

function binaryLength(data) {
  if (data == null) return 0;
  if (typeof data.byteLength === "number") return data.byteLength;
  if (typeof data.length === "number") return data.length;
  return 0;
}

function probeHeaders(rangeBytes) {
  const headers = {
    Range: `bytes=0-${rangeBytes - 1}`,
    "Accept-Encoding": "identity",
    [AUTO_HEADER]: "1",
  };
  for (const name of ["user-agent", "referer", "origin", "accept", "accept-language"]) {
    const value = getHeader($request.headers, name);
    if (value) headers[name] = value;
  }
  return headers;
}

function failureKind(result) {
  if (!result || result.ok) return "";
  const error = String(result.error || "").toLowerCase();
  if (error.includes("empty dns response")) return "dns";
  if (error.includes("budget")) return "budget";
  if (error.includes("timeout") || error.includes("timed out")) return "timeout";
  if (Number(result.status || 0) >= 300) return "http";
  if (Number(result.bytes || 0) === 0 && Number(result.status || 0) > 0) return "empty";
  if (Number(result.status || 0) > 0) return "http";
  return "other";
}

function candidateSet(sample) {
  const family = sample ? sample.signatureFamily : "unknown";
  const out = [];
  const seen = new Set();
  const push = (region, node, baseline = false) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    out.push({ region, node, baseline });
  };
  if (sample && sample.host) push("原始", sample.host, true);
  for (const item of FAMILY_CANDIDATES[family] || []) push(item.region, item.node, false);
  return out;
}

function probeNode(item, sample, rangeBytes, timeout, deadlineAt) {
  return new Promise((resolve) => {
    const remaining = deadlineAt - Date.now();
    const base = {
      ...item,
      nodeFamily: classifyHostFamily(item.node),
      sampleHost: sample ? sample.host : "",
      sampleFamily: sample ? sample.signatureFamily : "unknown",
      familyMatched: Boolean(sample && classifyHostFamily(item.node) === sample.signatureFamily),
    };
    if (remaining < 300) {
      resolve({ ...base, ok: false, mbps: 0, bytes: 0, elapsed: 0, status: 0, error: "test budget exhausted" });
      return;
    }
    const url = item.baseline ? sample.url : sampleUrlForNode(sample.url, item.node);
    if (!url) {
      resolve({ ...base, ok: false, mbps: 0, bytes: 0, elapsed: 0, status: 0, error: "invalid sample URL" });
      return;
    }
    const effectiveTimeout = Math.max(300, Math.min(timeout, remaining - 150));
    const started = Date.now();
    hardHttpGet({
      url,
      node: "DIRECT",
      headers: probeHeaders(rangeBytes),
      "binary-mode": true,
      "auto-redirect": false,
      "auto-cookie": false,
    }, effectiveTimeout, (error, response, data) => {
      const elapsed = Math.max(1, Date.now() - started);
      const bytes = binaryLength(data);
      const status = response && response.status ? response.status : 0;
      const acceptedStatus = status === 206 || (status === 200 && bytes > 0 && bytes <= rangeBytes * 1.25);
      const ok = !error && acceptedStatus && bytes > 0;
      const mbps = ok ? (bytes * 8 / 1e6) / (elapsed / 1000) : 0;
      resolve({ ...base, ok, mbps, bytes, elapsed, status, error: error ? String(error) : null });
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
  return (results || [])
    .filter((item) => item && item.ok && item.mbps > 0)
    .sort((a, b) => b.mbps - a.mbps || a.elapsed - b.elapsed);
}

function dedupeResults(stage1, stage2) {
  const map = new Map();
  const keep = (item, stage) => {
    if (!item || !item.ok || !(item.mbps > 0)) return;
    const next = { ...item, stage };
    const current = map.get(item.node);
    if (!current || stage > current.stage || (stage === current.stage && next.mbps > current.mbps)) map.set(item.node, next);
  };
  for (const item of stage1 || []) keep(item, 1);
  for (const item of stage2 || []) keep(item, 2);
  return [...map.values()].sort((a, b) => b.stage - a.stage || b.mbps - a.mbps || a.elapsed - b.elapsed);
}

function summarizeAttempts(stage1, stage2) {
  const attempts = [
    ...(stage1 || []).map((item) => ({ ...item, stage: 1 })),
    ...(stage2 || []).map((item) => ({ ...item, stage: 2 })),
  ];
  const stats = {
    attempts: attempts.length, ok: 0, failed: 0,
    dns: 0, timeout: 0, http: 0, empty: 0, budget: 0, other: 0,
    familyMatchedAttempts: 0, familyMatchedOk: 0,
    stage1Attempts: (stage1 || []).length, stage1Ok: 0,
    stage2Attempts: (stage2 || []).length, stage2Ok: 0,
  };
  const failures = [];
  for (const item of attempts) {
    if (item.familyMatched) stats.familyMatchedAttempts += 1;
    if (item.ok) {
      stats.ok += 1;
      if (item.familyMatched) stats.familyMatchedOk += 1;
      if (item.stage === 1) stats.stage1Ok += 1;
      if (item.stage === 2) stats.stage2Ok += 1;
      continue;
    }
    stats.failed += 1;
    const kind = failureKind(item);
    stats[kind] = (stats[kind] || 0) + 1;
    failures.push({
      node: item.node, region: item.region, stage: item.stage,
      status: Number(item.status || 0),
      error: item.error ? String(item.error).slice(0, 160) : "",
      kind,
      nodeFamily: item.nodeFamily || "unknown",
      sampleHost: item.sampleHost || "",
      sampleFamily: item.sampleFamily || "unknown",
      familyMatched: Boolean(item.familyMatched),
    });
  }
  return { stats, failures: failures.slice(0, 32) };
}

function formatResultLine(item, index) {
  const stage = item.stage === 2 ? "精测" : "初筛";
  const baseline = item.baseline ? " · 原始基线" : "";
  return `${index + 1}. ${item.node} — ${item.mbps.toFixed(1)} Mbps (${item.region} · ${stage}${baseline})`;
}

function notifyRanking(entry) {
  const top = (entry.ranking || []).slice(0, 5);
  const stats = entry.stats || {};
  const body = [
    ...top.map(formatResultLine),
    "",
    `family=${entry.probeFamily || "unknown"}；成功 ${stats.ok || 0}/${stats.attempts || 0}；DNS ${stats.dns || 0}；超时 ${stats.timeout || 0}；HTTP ${stats.http || 0}`,
  ].filter(Boolean).join("\n");
  const full = [
    ...(entry.ranking || []).map(formatResultLine),
    "",
    "---- 失败诊断 ----",
    ...(entry.failures || []).map((item, index) =>
      `F${index + 1}. ${item.node} — ${item.kind}${item.status ? ` HTTP ${item.status}` : ""} (${item.region} · ${item.stage === 2 ? "精测" : "初筛"})${item.error ? ` · ${item.error}` : ""}`
    ),
  ].join("\n");
  try {
    $notification.post("📺 BiliBili CDN 自动测速完成", `${entry.bestMbps.toFixed(1)} Mbps · ${entry.bestRegion || "未知地区"}`, body, { clipboard: full });
  } catch (_) {
    $notification.post("📺 BiliBili CDN 自动测速完成", entry.best, body);
  }
}

async function runAutoSpeedTest(sample, startedAt, cdn, requestHost) {
  if (!sample) throw new Error("无法解析当前媒体 signed URL");
  const deadlineAt = startedAt + TEST_BUDGET_MS;
  const candidates = candidateSet(sample);
  if (!candidates.length) throw new Error(`family=${sample.signatureFamily} 没有可测速候选`);

  writeStatus("testing", {
    auto: true, cdn, phase: "同 family 初筛", startedAt,
    sampleHost: requestHost, sampleCount: 1, sampleFamilies: [sample.signatureFamily],
    probeFamily: sample.signatureFamily, requestHost,
    message: `fallback 单 signed URL：仅比较 ${sample.signatureFamily} family，共 ${candidates.length} 个候选；$httpClient 显式 DIRECT。`,
  });
  console.log(`[BiliBili Redirect] CDN fallback family 初筛：${sample.signatureFamily}，${candidates.length} 个候选，DIRECT`);

  const stage1 = await runConcurrent(
    candidates,
    STAGE1_CONCURRENCY,
    (item) => probeNode(item, sample, STAGE1_BYTES, STAGE1_TIMEOUT_MS, deadlineAt),
  );
  const stage1Ok = sortResults(stage1);
  if (!stage1Ok.length) {
    const d = summarizeAttempts(stage1, []);
    throw new Error(`family 初筛无可用结果：DNS ${d.stats.dns}，超时 ${d.stats.timeout}，HTTP ${d.stats.http}，其他 ${d.stats.other}`);
  }

  const stage2Items = stage1Ok.map((item) => ({
    region: item.region,
    node: item.node,
    baseline: Boolean(item.baseline),
  }));

  writeStatus("testing", {
    auto: true, cdn, phase: "同 family 精测", startedAt,
    sampleHost: requestHost, sampleCount: 1, sampleFamilies: [sample.signatureFamily],
    probeFamily: sample.signatureFamily, requestHost,
    message: `初筛成功 ${stage1Ok.length}/${candidates.length}；精测 ${stage2Items.length} 个同 family 节点。`,
  });
  console.log(`[BiliBili Redirect] CDN fallback family 精测：${stage2Items.length} 个候选`);

  let stage2 = [];
  if (deadlineAt - Date.now() > 700) {
    stage2 = await runConcurrent(
      stage2Items,
      STAGE2_CONCURRENCY,
      (item) => probeNode(item, sample, STAGE2_BYTES, STAGE2_TIMEOUT_MS, deadlineAt),
    );
  }

  const stage2Ok = sortResults(stage2);
  const ranking = dedupeResults(stage1, stage2);
  const best = stage2Ok[0] || stage1Ok[0];
  const diagnostics = summarizeAttempts(stage1, stage2);
  const entry = {
    version: 7,
    poolVersion: POOL_VERSION,
    engineVersion: ENGINE_VERSION,
    mode: "family-focused-direct",
    at: Date.now(),
    network: networkKey(),
    source: "cdn-request",
    best: best.node,
    bestMbps: best.mbps,
    bestRegion: best.region,
    probeFamily: sample.signatureFamily,
    sampleHost: requestHost,
    sampleCount: 1,
    sampleFamilies: [sample.signatureFamily],
    elapsedMs: Date.now() - startedAt,
    stats: diagnostics.stats,
    failures: diagnostics.failures,
    ranking: ranking.map((item) => ({
      node: item.node, region: item.region, mbps: Number(item.mbps.toFixed(3)),
      elapsed: item.elapsed, bytes: item.bytes, status: item.status, stage: item.stage,
      nodeFamily: item.nodeFamily, sampleHost: item.sampleHost, sampleFamily: item.sampleFamily,
      familyMatched: Boolean(item.familyMatched), baseline: Boolean(item.baseline),
    })),
  };
  saveRanking(entry);
  notifyRanking(entry);
  console.log(`[BiliBili Redirect] family=${entry.probeFamily} 测速诊断：成功 ${entry.stats.ok}/${entry.stats.attempts}，DNS ${entry.stats.dns}，超时 ${entry.stats.timeout}，HTTP ${entry.stats.http}`);
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
  const sample = describeSample($request.url);
  const family = sample ? sample.signatureFamily : "unknown";

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

  const cached = loadCachedRanking(family);
  if (cached) {
    writeStatus("cached", {
      auto, cdn, selected: cached.best, bestMbps: cached.bestMbps, bestRegion: cached.bestRegion,
      probeFamily: cached.probeFamily, requestHost,
    });
    console.log(`[BiliBili Redirect] CDN fallback 使用 ${family} family 测速缓存：${cached.best} (${Number(cached.bestMbps || 0).toFixed(1)} Mbps)`);
    rewriteRequest(cached.best);
    return;
  }

  const lock = acquireLock();
  if (!lock) {
    console.log("[BiliBili Redirect] 已有测速任务运行，本请求临时使用手动 CDN");
    if (typeof cdn === "string" && cdn && !isSeparator(cdn)) rewriteRequest(cdn);
    else $done({});
    return;
  }

  const startedAt = Date.now();
  try {
    writeStatus("testing", {
      auto, cdn, phase: "准备", startedAt, sampleHost: requestHost,
      sampleCount: sample ? 1 : 0, sampleFamilies: sample ? [family] : [],
      probeFamily: family, requestHost,
      message: "手动 A/B 已确认 Host-only 改写可正常播放；fallback 改为同 family 小池 + DIRECT + 更长建连窗口。",
    });
    const entry = await runAutoSpeedTest(sample, startedAt, cdn, requestHost);
    releaseLock(lock.token);
    writeStatus("success", {
      auto, cdn, selected: entry.best, bestMbps: entry.bestMbps, bestRegion: entry.bestRegion,
      elapsedMs: entry.elapsedMs, stats: entry.stats, probeFamily: entry.probeFamily,
      sampleCount: entry.sampleCount, sampleFamilies: entry.sampleFamilies, requestHost,
      message: `同 family 测速在 ${(entry.elapsedMs / 1000).toFixed(1)} 秒内完成；成功 ${entry.stats.ok}/${entry.stats.attempts}`,
    });
    rewriteRequest(entry.best);
  } catch (error) {
    releaseLock(lock.token);
    const message = String(error);
    writeStatus("error", { auto, cdn, startedAt, elapsedMs: Date.now() - startedAt, probeFamily: family, message, requestHost });
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

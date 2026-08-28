const FAMILY_CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.family.v1";
const LOCK_KEY = "BiliBili.Redirect.CCBStyle.speed.lock.v2";
const STATUS_KEY = "BiliBili.Redirect.CCBStyle.status.v1";
const NOTIFY_KEY = "BiliBili.Redirect.CCBStyle.speed.notify.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
const LOCK_TTL_MS = 20 * 1000;
const TEST_BUDGET_MS = 16000;
const ENGINE_VERSION = 9;
const AUTO_HEADER = "X-CCB-Speedtest";

// Adapted from realzza/bilibili-accelerator's throughput-first probe design:
// measure every small-pool candidate with the same payload size instead of
// eliminating candidates with a short warm-up probe. Browser fetch can retain
// partial bytes on abort; Loon's $httpClient cannot, so transient failures get
// one low-concurrency retry with the same 768 KiB sample.
const PROBE_BYTES = 768 * 1024;
const PROBE_TIMEOUT_MS = 5000;
const PROBE_CONCURRENCY = 3;
const RETRY_TIMEOUT_MS = 6500;
const RETRY_CONCURRENCY = 1;

// CDN-request fallback has only one signed media URL, so only compare nodes
// from the same CDN family. playurl-response remains responsible for broader
// multi-family testing when multiple signed URLs are available.
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
  const bucket = readMap(FAMILY_CACHE_KEY)[networkKey()];
  if (!bucket || typeof bucket !== "object" || !bucket.families) return null;
  const entry = bucket.families[family];
  if (!entry || typeof entry !== "object") return null;
  if (entry.engineVersion !== ENGINE_VERSION) return null;
  if (typeof entry.at !== "number" || Date.now() - entry.at > CACHE_TTL_MS) return null;
  if (typeof entry.best !== "string" || !entry.best) return null;
  return entry;
}

function saveRanking(entry) {
  const key = networkKey();
  const map = readMap(FAMILY_CACHE_KEY);
  const current = map[key] && typeof map[key] === "object" ? map[key] : {};
  const families = current.families && typeof current.families === "object" ? current.families : {};
  families[entry.probeFamily || "unknown"] = entry;
  map[key] = { network: key, at: entry.at || Date.now(), families };
  return writeMap(FAMILY_CACHE_KEY, map, 8);
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

function shouldRetryProbe(result) {
  if (!result || result.ok) return false;
  const kind = failureKind(result);
  return kind === "timeout" || kind === "dns" || kind === "other";
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

function mergeProbeResults(firstPass, retries) {
  const byNode = new Map();
  for (const item of firstPass || []) byNode.set(item.node, { ...item, stage: 1, stageName: "首测" });
  for (const item of retries || []) {
    const current = byNode.get(item.node);
    if (item.ok || !current) byNode.set(item.node, { ...item, stage: 2, stageName: "重试" });
  }
  return [...byNode.values()];
}

function summarizeAttempts(firstPass, retries) {
  const attempts = [
    ...(firstPass || []).map((item) => ({ ...item, stage: 1, stageName: "首测" })),
    ...(retries || []).map((item) => ({ ...item, stage: 2, stageName: "重试" })),
  ];
  const stats = {
    attempts: attempts.length, ok: 0, failed: 0,
    dns: 0, timeout: 0, http: 0, empty: 0, budget: 0, other: 0,
    familyMatchedAttempts: 0, familyMatchedOk: 0,
    stage1Attempts: (firstPass || []).length, stage1Ok: 0,
    stage2Attempts: (retries || []).length, stage2Ok: 0,
    firstAttempts: (firstPass || []).length, firstOk: 0,
    retryAttempts: (retries || []).length, retryOk: 0,
  };
  const failures = [];
  for (const item of attempts) {
    if (item.familyMatched) stats.familyMatchedAttempts += 1;
    if (item.ok) {
      stats.ok += 1;
      if (item.familyMatched) stats.familyMatchedOk += 1;
      if (item.stage === 1) { stats.stage1Ok += 1; stats.firstOk += 1; }
      if (item.stage === 2) { stats.stage2Ok += 1; stats.retryOk += 1; }
      continue;
    }
    stats.failed += 1;
    const kind = failureKind(item);
    stats[kind] = (stats[kind] || 0) + 1;
    failures.push({
      node: item.node, region: item.region, stage: item.stage, stageName: item.stageName,
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
  const stage = item.stageName || (item.stage === 2 ? "重试" : "首测");
  const baseline = item.baseline ? " · 原始基线" : "";
  return `${index + 1}. ${item.node} — ${item.mbps.toFixed(1)} Mbps (${item.region} · ${stage}${baseline})`;
}

function shouldNotify(entry) {
  if (!entry || !entry.best || entry.best === entry.sampleHost) return false;
  const key = networkKey();
  const map = readMap(NOTIFY_KEY);
  const last = map[key];
  if (last && typeof last.at === "number" && Date.now() - last.at < NOTIFY_COOLDOWN_MS) return false;
  map[key] = { at: Date.now(), family: entry.probeFamily, best: entry.best };
  writeMap(NOTIFY_KEY, map, 8);
  return true;
}

function notifyRanking(entry) {
  if (!shouldNotify(entry)) {
    console.log(`[BiliBili Redirect] family=${entry.probeFamily} 测速完成，通知已静默（原 CDN 最优或处于 5 分钟冷却期）`);
    return;
  }
  const top = (entry.ranking || []).slice(0, 5);
  const stats = entry.stats || {};
  const body = [
    ...top.map(formatResultLine),
    "",
    `family=${entry.probeFamily || "unknown"}；首测 ${stats.firstOk || 0}/${stats.firstAttempts || 0}；重试 ${stats.retryOk || 0}/${stats.retryAttempts || 0}`,
  ].filter(Boolean).join("\n");
  const full = [
    ...(entry.ranking || []).map(formatResultLine),
    "",
    "---- 失败诊断 ----",
    ...(entry.failures || []).map((item, index) =>
      `F${index + 1}. ${item.node} — ${item.kind}${item.status ? ` HTTP ${item.status}` : ""} (${item.region} · ${item.stageName || (item.stage === 2 ? "重试" : "首测")})${item.error ? ` · ${item.error}` : ""}`
    ),
  ].join("\n");
  try {
    $notification.post("📺 BiliBili CDN 自动测速完成", `${entry.bestMbps.toFixed(1)} Mbps · ${entry.bestRegion || "未知地区"}`, body, { clipboard: full });
  } catch (_) {
    $notification.post("📺 BiliBili CDN 自动测速完成", entry.best, body);
  }
}

function savePassthrough(sample, requestHost) {
  const entry = {
    version: 9,
    engineVersion: ENGINE_VERSION,
    mode: "single-candidate-passthrough",
    at: Date.now(),
    network: networkKey(),
    source: "cdn-request",
    best: sample.host,
    bestMbps: 0,
    bestRegion: "原始",
    probeFamily: sample.signatureFamily,
    sampleHost: requestHost,
    sampleCount: 1,
    sampleFamilies: [sample.signatureFamily],
    elapsedMs: 0,
    stats: { attempts: 0, ok: 0, failed: 0, firstAttempts: 0, firstOk: 0, retryAttempts: 0, retryOk: 0 },
    failures: [],
    ranking: [],
  };
  saveRanking(entry);
  return entry;
}

async function runAutoSpeedTest(sample, candidates, startedAt, cdn, requestHost) {
  if (!sample) throw new Error("无法解析当前媒体 signed URL");
  const deadlineAt = startedAt + TEST_BUDGET_MS;
  if (!candidates.length) throw new Error(`family=${sample.signatureFamily} 没有可测速候选`);

  writeStatus("testing", {
    auto: true, cdn, phase: "同 family 全量吞吐测试", startedAt,
    sampleHost: requestHost, sampleCount: 1, sampleFamilies: [sample.signatureFamily],
    probeFamily: sample.signatureFamily, requestHost,
    message: `参考 Bilibili Accelerator：${candidates.length} 个同 family 候选统一读取 768 KiB，不再用短初筛淘汰；$httpClient 显式 DIRECT。`,
  });
  console.log(`[BiliBili Redirect] CDN fallback family 全量吞吐：${sample.signatureFamily}，${candidates.length} 个候选，768 KiB，DIRECT`);

  const firstPass = await runConcurrent(
    candidates,
    PROBE_CONCURRENCY,
    (item) => probeNode(item, sample, PROBE_BYTES, PROBE_TIMEOUT_MS, deadlineAt),
  );

  let retryItems = firstPass
    .filter(shouldRetryProbe)
    .map((item) => ({ region: item.region, node: item.node, baseline: Boolean(item.baseline) }));

  // Retry the configured manual fallback first when it belongs to this family.
  if (typeof cdn === "string" && cdn) {
    retryItems = retryItems.sort((a, b) => Number(b.node === cdn) - Number(a.node === cdn));
  }

  let retries = [];
  if (retryItems.length && deadlineAt - Date.now() > 800) {
    writeStatus("testing", {
      auto: true, cdn, phase: "瞬时失败重试", startedAt,
      sampleHost: requestHost, sampleCount: 1, sampleFamilies: [sample.signatureFamily],
      probeFamily: sample.signatureFamily, requestHost,
      message: `首测 ${sortResults(firstPass).length}/${candidates.length} 成功；对 ${retryItems.length} 个 DNS/超时/连接异常节点低并发重试，手动 fallback 节点优先。`,
    });
    console.log(`[BiliBili Redirect] family=${sample.signatureFamily} 首测失败 ${retryItems.length} 个，开始低并发同尺寸重试`);
    retries = await runConcurrent(
      retryItems,
      RETRY_CONCURRENCY,
      (item) => probeNode(item, sample, PROBE_BYTES, RETRY_TIMEOUT_MS, deadlineAt),
    );
  }

  const merged = mergeProbeResults(firstPass, retries);
  const ranking = sortResults(merged);
  const diagnostics = summarizeAttempts(firstPass, retries);
  if (!ranking.length) {
    throw new Error(`family 全量测速无可用结果：DNS ${diagnostics.stats.dns}，超时 ${diagnostics.stats.timeout}，HTTP ${diagnostics.stats.http}，其他 ${diagnostics.stats.other}`);
  }
  const best = ranking[0];
  const entry = {
    version: 9,
    engineVersion: ENGINE_VERSION,
    mode: "family-full-probe-retry",
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
      stageName: item.stageName,
      nodeFamily: item.nodeFamily, sampleHost: item.sampleHost, sampleFamily: item.sampleFamily,
      familyMatched: Boolean(item.familyMatched), baseline: Boolean(item.baseline),
    })),
  };
  saveRanking(entry);
  notifyRanking(entry);
  console.log(`[BiliBili Redirect] family=${entry.probeFamily} 全量测速：首测 ${entry.stats.firstOk}/${entry.stats.firstAttempts}，重试 ${entry.stats.retryOk}/${entry.stats.retryAttempts}，最终可排名 ${entry.ranking.length}`);
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
      message: `${family} family 命中独立 6 小时缓存，不再重复测速/通知。`,
    });
    console.log(`[BiliBili Redirect] CDN fallback 使用 ${family} family 独立缓存：${cached.best}${cached.bestMbps > 0 ? ` (${Number(cached.bestMbps).toFixed(1)} Mbps)` : ""}`);
    rewriteRequest(cached.best);
    return;
  }

  if (!sample) {
    writeStatus("error", { auto, cdn, message: "无法解析当前媒体 signed URL", requestHost });
    if (typeof cdn === "string" && cdn && !isSeparator(cdn)) rewriteRequest(cdn);
    else $done({});
    return;
  }

  const candidates = candidateSet(sample);
  if (candidates.length <= 1) {
    const entry = savePassthrough(sample, requestHost);
    writeStatus("cached", {
      auto, cdn, selected: entry.best, probeFamily: family, requestHost,
      message: `${family} family 只有原始 CDN，没有可比较候选；已静默缓存 6 小时，不执行测速也不发送通知。`,
    });
    console.log(`[BiliBili Redirect] family=${family} 只有原始 CDN，静默缓存并跳过测速`);
    rewriteRequest(entry.best);
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
      sampleCount: 1, sampleFamilies: [family], probeFamily: family, requestHost,
      message: "fallback 采用 Accelerator 风格同尺寸全量吞吐测试；瞬时失败低并发重试，结果按网络与 CDN family 独立缓存。",
    });
    const entry = await runAutoSpeedTest(sample, candidates, startedAt, cdn, requestHost);
    releaseLock(lock.token);
    writeStatus("success", {
      auto, cdn, selected: entry.best, bestMbps: entry.bestMbps, bestRegion: entry.bestRegion,
      elapsedMs: entry.elapsedMs, stats: entry.stats, probeFamily: entry.probeFamily,
      sampleCount: entry.sampleCount, sampleFamilies: entry.sampleFamilies, requestHost,
      message: `同 family 全量测速完成并独立缓存 6 小时；首测 ${entry.stats.firstOk}/${entry.stats.firstAttempts}，重试 ${entry.stats.retryOk}/${entry.stats.retryAttempts}`,
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
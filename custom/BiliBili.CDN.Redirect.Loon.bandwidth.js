const FAMILY_CACHE_KEY = "BiliBili.CDN.Redirect.Loon.speed.family.v1";
const STATUS_KEY = "BiliBili.CDN.Redirect.Loon.status.v1";
const DONOR_POOL_KEY = "BiliBili.CDN.Redirect.Loon.donor.family.v1";
const AUTO_HEADER = "X-BiliBili-CDN-Redirect-Speedtest";
const DEFAULT_TEST_BVID = "BV1eL4k6jEjd";
const DEFAULT_TARGET_SECONDS = 6;
const MIN_TARGET_SECONDS = 3;
const MAX_TARGET_SECONDS = 10;
const PAGE_TIMEOUT_MS = 7000;
const RECENT_SAMPLE_TTL_MS = 30 * 60 * 1000;
const PREFLIGHT_TIMEOUT_MS = 10000;
const CALIBRATION_TIMEOUT_MS = 12000;
const TRANSFER_TIMEOUT_MS = 12000;
const ROUND_COUNT = 3;
const CHUNK_TARGET_SECONDS = 1.25;
const MAX_REQUESTS_PER_ROUND = 64;

const API_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  Referer: "https://www.bilibili.com/",
  Origin: "https://www.bilibili.com",
  Accept: "application/json,text/plain,*/*",
  "Accept-Encoding": "identity",
  [AUTO_HEADER]: "1",
};

const PAGE_HEADERS = {
  "User-Agent": API_HEADERS["User-Agent"],
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  [AUTO_HEADER]: "1",
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

function runtimeConfig() {
  try {
    const config = JSON.parse($config.getConfig());
    return config && typeof config === "object" ? config : {};
  } catch (_) {
    return {};
  }
}

function networkKey() {
  const config = runtimeConfig();
  const ssid = config.ssid ? String(config.ssid) : "cellular-or-unknown";
  const mode = config.running_model !== undefined ? String(config.running_model) : "unknown";
  return `${ssid}|mode=${mode}`;
}

function isCellular() {
  const ssid = String(runtimeConfig().ssid || "").trim().toLowerCase();
  return !ssid || ssid === "cellular" || ssid.includes("蜂窝") || ssid.includes("mobile");
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

function urlFamily(raw) {
  try {
    const url = new URL(raw);
    return normalizeOsFamily(url.searchParams.get("os")) || classifyHostFamily(url.hostname);
  } catch (_) {
    return "unknown";
  }
}

function isMediaUrl(raw) {
  if (typeof raw !== "string" || !/^https?:\/\//i.test(raw)) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host.endsWith(".bilivideo.com") || host.endsWith(".bilivideo.cn") || host.endsWith(".acgvideo.com") || host.endsWith(".akamaized.net");
  } catch (_) {
    return false;
  }
}

function currentTarget(options) {
  const key = networkKey();
  const auto = isAutoEnabled(options.auto);
  const manualValid = typeof options.cdn === "string" && options.cdn && !isSeparator(options.cdn);

  if (!auto && manualValid) {
    return { node: options.cdn, family: classifyHostFamily(options.cdn), source: "手动选择" };
  }

  const status = readMap(STATUS_KEY)[key];
  if (auto && status && status.auto !== false && typeof status.selected === "string" && status.selected) {
    const source = status.source === "cdn-request" ? "最近实际请求" : "最近 playurl 选择";
    return { node: status.selected, family: status.probeFamily || classifyHostFamily(status.selected), source };
  }

  if (auto) {
    const bucket = readMap(FAMILY_CACHE_KEY)[key];
    if (bucket && bucket.families && typeof bucket.families === "object") {
      const entries = Object.entries(bucket.families)
        .filter(([, entry]) => entry && typeof entry.best === "string" && entry.best)
        .sort((a, b) => Number((b[1] && b[1].at) || 0) - Number((a[1] && a[1].at) || 0));
      if (entries.length) {
        const [family, entry] = entries[0];
        return { node: entry.best, family: entry.probeFamily || family, source: `${family} 自动缓存` };
      }
    }
  }

  if (manualValid) {
    return { node: options.cdn, family: classifyHostFamily(options.cdn), source: "手动 fallback" };
  }
  return null;
}

function configuredBvid(options) {
  const value = String((options && options.test_bvid) || DEFAULT_TEST_BVID).trim();
  return /^BV[0-9A-Za-z]+$/.test(value) ? value : null;
}

function configuredTargetSeconds(options) {
  const raw = Number(options && options.test_seconds);
  const value = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TARGET_SECONDS;
  return Math.max(MIN_TARGET_SECONDS, Math.min(MAX_TARGET_SECONDS, value));
}

function hardHttpGet(params, hardTimeout) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (error, response, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ error, response, data });
    };
    const timer = setTimeout(() => finish(`hard timeout ${hardTimeout}ms`, null, null), hardTimeout + 150);
    try {
      $httpClient.get({ ...params, timeout: hardTimeout }, (error, response, data) => finish(error, response, data));
    } catch (error) {
      finish(error, null, null);
    }
  });
}

function responseStatus(response) {
  return Number((response && (response.status || response.statusCode)) || 0);
}

function responseHeader(response, wanted) {
  const headers = response && response.headers;
  if (!headers || typeof headers !== "object") return "";
  const key = Object.keys(headers).find((name) => name.toLowerCase() === wanted.toLowerCase());
  return key ? String(headers[key] || "") : "";
}

function contentRangeTotal(response) {
  const match = responseHeader(response, "content-range").match(/\/(\d+|\*)$/);
  return !match || match[1] === "*" ? 0 : Number(match[1]) || 0;
}

function addStreamUrls(out, stream) {
  if (!stream || typeof stream !== "object") return;
  for (const key of ["baseUrl", "base_url", "url"]) {
    if (isMediaUrl(stream[key])) out.push(stream[key]);
  }
  for (const key of ["backupUrl", "backup_url", "backup_url_list"]) {
    const value = stream[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isMediaUrl(item)) out.push(item);
    }
  }
}

function mediaUrlsFromPlayurl(payload) {
  const data = (payload && (payload.data || payload.result)) || {};
  const out = [];
  const videos = Array.isArray(data.dash && data.dash.video) ? [...data.dash.video] : [];
  videos.sort((a, b) => Number((b && b.bandwidth) || 0) - Number((a && a.bandwidth) || 0));
  for (const stream of videos) addStreamUrls(out, stream);
  if (data.dash && Array.isArray(data.dash.audio)) {
    for (const stream of data.dash.audio) addStreamUrls(out, stream);
  }
  if (Array.isArray(data.durl)) {
    for (const item of data.durl) addStreamUrls(out, item);
  }
  return [...new Set(out)];
}

function extractEmbeddedJson(text, marker) {
  const markerAt = String(text || "").indexOf(marker);
  if (markerAt < 0) return null;
  let start = markerAt + marker.length;
  while (start < text.length && /\s/.test(text[start])) start += 1;
  const opening = text[start];
  if (opening !== "{" && opening !== "[") return null;
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === opening) depth += 1;
    else if (ch === closing) {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

function recentEnough(at) {
  return typeof at === "number" && Date.now() - at <= RECENT_SAMPLE_TTL_MS;
}

function latestRecentRequest(bucket) {
  let best = null;
  if (bucket && bucket.families && typeof bucket.families === "object") {
    for (const [family, entry] of Object.entries(bucket.families)) {
      const request = entry && entry.request;
      if (!request || !recentEnough(request.at) || !isMediaUrl(request.url)) continue;
      const headers = request.headers && typeof request.headers === "object" ? { ...request.headers } : {};
      if (!Object.keys(headers).length) continue;
      if (!best || request.at > best.at) {
        best = { family, url: request.url, headers, at: request.at };
      }
    }
  }

  const status = readMap(STATUS_KEY)[networkKey()];
  if (
    status &&
    status.source === "cdn-request" &&
    recentEnough(status.at) &&
    isMediaUrl(status.sampleUrl) &&
    status.sampleHeaders &&
    typeof status.sampleHeaders === "object" &&
    Object.keys(status.sampleHeaders).length &&
    (!best || status.at > best.at)
  ) {
    best = {
      family: urlFamily(status.sampleUrl),
      url: status.sampleUrl,
      headers: { ...status.sampleHeaders },
      at: status.at,
    };
  }
  return best;
}

function recentSignedDonor(targetFamily) {
  const bucket = readMap(DONOR_POOL_KEY)[networkKey()];
  const familyEntry = bucket && bucket.families && bucket.families[targetFamily];

  if (familyEntry && familyEntry.request) {
    const request = familyEntry.request;
    const headers = request.headers && typeof request.headers === "object" ? { ...request.headers } : {};
    if (recentEnough(request.at) && isMediaUrl(request.url) && Object.keys(headers).length) {
      return {
        url: request.url,
        family: targetFamily,
        exactFamily: true,
        source: "最近同 family 真实视频请求",
        headers,
      };
    }
  }

  const latestRequest = latestRecentRequest(bucket);
  if (familyEntry && familyEntry.playurl) {
    const playurl = familyEntry.playurl;
    if (recentEnough(playurl.at) && isMediaUrl(playurl.url)) {
      return {
        url: playurl.url,
        family: targetFamily,
        exactFamily: true,
        source: "最近 playurl 同 family URL",
        headers: latestRequest ? latestRequest.headers : null,
      };
    }
  }

  if (latestRequest) {
    return {
      url: latestRequest.url,
      family: latestRequest.family,
      exactFamily: latestRequest.family === targetFamily,
      source: latestRequest.family === targetFamily ? "最近同 family 真实视频请求" : "最近真实视频请求",
      headers: latestRequest.headers,
    };
  }
  return null;
}

async function pageDonor(bvid, targetFamily) {
  const pageUrl = `https://www.bilibili.com/video/${encodeURIComponent(bvid)}/`;
  const { error, response, data } = await hardHttpGet({
    url: pageUrl,
    node: "DIRECT",
    headers: PAGE_HEADERS,
    "auto-redirect": true,
    "auto-cookie": true,
  }, PAGE_TIMEOUT_MS);
  if (error) throw new Error(`视频网页请求失败：${error}`);
  const status = responseStatus(response);
  if (status !== 200) {
    const suffix = status === 412 ? "（Bilibili 风控拒绝）" : "";
    throw new Error(`视频网页 HTTP ${status || "无响应"}${suffix}`);
  }

  const html = typeof data === "string" ? data : String(data || "");
  const play = extractEmbeddedJson(html, "window.__playinfo__=")
    || extractEmbeddedJson(html, "window.__playinfo__ =");
  if (!play) throw new Error("视频网页没有内嵌 __playinfo__");

  const urls = mediaUrlsFromPlayurl(play);
  if (!urls.length) throw new Error("视频网页 __playinfo__ 没有可用媒体 URL");
  const matched = urls.find((url) => urlFamily(url) === targetFamily);
  const selected = matched || urls[0];
  return {
    url: selected,
    family: urlFamily(selected),
    exactFamily: Boolean(matched),
    source: `配置 BV 网页（${bvid}）`,
    headers: {
      "user-agent": API_HEADERS["User-Agent"],
      referer: pageUrl,
      origin: API_HEADERS.Origin,
      accept: "*/*",
      "accept-language": PAGE_HEADERS["Accept-Language"],
    },
  };
}

async function freshDonor(bvid, targetFamily) {
  const recent = recentSignedDonor(targetFamily);
  if (recent) {
    console.log(`[BiliBili CDN Redirect] 使用${recent.source}作为 signed URL donor${recent.exactFamily ? "（同 family）" : "（跨 family fallback）"}。`);
    return recent;
  }

  try {
    return await pageDonor(bvid, targetFamily);
  } catch (error) {
    const pageError = String(error);
    console.log(`[BiliBili CDN Redirect] 配置 BV 网页 donor 获取失败：${pageError}`);
    throw new Error(
      `无法取得测速 signed URL：${pageError}。请先正常播放一个 Bilibili 视频，再运行本测速。`
    );
  }
}

function swapHost(raw, node) {
  const url = new URL(raw);
  url.protocol = "https:";
  url.hostname = node;
  url.port = "";
  return url.toString();
}

function sampleIssue(sample) {
  if (!sample) return "无响应";
  if (sample.error) return String(sample.error);
  if (sample.status) return `HTTP ${sample.status}`;
  return "无响应";
}

async function preflightDonor(donor, target, profile) {
  const testUrl = swapHost(donor.url, target.node);
  const targetCheck = await measureOnce(
    testUrl,
    profile.preflightBytes,
    PREFLIGHT_TIMEOUT_MS,
    0,
    donor.headers,
  );
  if (targetCheck.ok) return { ok: true, testUrl, targetCheck, originalCheck: null };

  let originalCheck = null;
  let originalHost = "";
  try { originalHost = new URL(donor.url).hostname; } catch (_) {}
  if (originalHost && originalHost === target.node) {
    originalCheck = targetCheck;
  } else {
    originalCheck = await measureOnce(
      donor.url,
      Math.min(profile.preflightBytes, 256 * 1024),
      PREFLIGHT_TIMEOUT_MS,
      0,
      donor.headers,
    );
  }
  return { ok: false, testUrl, targetCheck, originalCheck, originalHost };
}

function preflightFailureMessage(donor, target, check) {
  const targetIssue = sampleIssue(check && check.targetCheck);
  const original = check && check.originalCheck;
  const sameHost = check && check.originalHost && check.originalHost === target.node;

  if (sameHost) {
    return `预检失败：目标节点就是 donor 原始 host，${targetIssue}。该 signed URL 可能已失效，或当前直连路径过慢/不可用`;
  }
  if (original && original.ok) {
    if (!donor.exactFamily) {
      return `预检失败：目标节点 ${targetIssue}；同一 signed URL 在原始 host 正常。当前 donor 为跨 family URL，目标节点可能不接受该跨 host/跨 family 请求，或当前直连路径不可用`;
    }
    return `预检失败：目标节点 ${targetIssue}；同一 signed URL 在原始 host 正常，目标节点当前不可用或不接受该 host 改写`;
  }
  return `预检失败：目标节点 ${targetIssue}；原始 host 也${original ? sampleIssue(original) : "无响应"}，signed URL 可能已失效或当前网络/请求条件异常`;
}

function binaryLength(data) {
  if (data == null) return 0;
  if (typeof data.byteLength === "number") return data.byteLength;
  if (typeof data.length === "number") return data.length;
  return 0;
}

function mediaHeaders(baseHeaders, start, end) {
  const headers = {};
  if (baseHeaders && typeof baseHeaders === "object") {
    for (const [name, value] of Object.entries(baseHeaders)) {
      const lower = String(name).toLowerCase();
      if (["host", ":authority", "range", "accept-encoding", "content-length"].includes(lower)) continue;
      if (value !== undefined && value !== null && String(value)) headers[name] = String(value);
    }
  }
  headers["Accept-Encoding"] = "identity";
  headers["Cache-Control"] = "no-cache";
  headers.Pragma = "no-cache";
  headers.Range = `bytes=${start}-${end}`;
  headers[AUTO_HEADER] = "1";
  return headers;
}

async function measureOnce(url, requestedBytes, timeout, startByte = 0, baseHeaders = null) {
  const start = Math.max(0, Math.floor(startByte));
  const end = start + Math.max(1, Math.floor(requestedBytes)) - 1;
  const headers = mediaHeaders(
    baseHeaders || {
      "user-agent": API_HEADERS["User-Agent"],
      referer: API_HEADERS.Referer,
      origin: API_HEADERS.Origin,
      accept: "*/*",
    },
    start,
    end,
  );
  const started = Date.now();
  const { error, response, data } = await hardHttpGet({
    url,
    node: "DIRECT",
    headers,
    "binary-mode": true,
    "auto-redirect": false,
    "auto-cookie": false,
  }, timeout);
  const elapsedMs = Math.max(1, Date.now() - started);
  const status = responseStatus(response);
  const bytes = binaryLength(data);
  const ok = !error && status === 206 && bytes > 0;
  return {
    ok,
    status,
    bytes,
    elapsedMs,
    mbps: ok ? (bytes * 8 / 1e6) / (elapsedMs / 1000) : 0,
    totalBytes: contentRangeTotal(response),
    error: error ? String(error) : (!ok ? `HTTP ${status || "无响应"}` : ""),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundBytes(value, quantum = 256 * 1024) {
  return Math.max(quantum, Math.round(value / quantum) * quantum);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mib(bytes) {
  return bytes / 1024 / 1024;
}

function rangeStart(index, chunkBytes, totalBytes) {
  if (!totalBytes || totalBytes <= chunkBytes) return 0;
  const span = totalBytes - chunkBytes;
  return Math.min(span, (index * chunkBytes) % (span + 1));
}

async function sustainedRound(url, chunkBytes, targetSeconds, maxRoundBytes, totalBytes, baseHeaders) {
  let bytes = 0;
  let elapsedMs = 0;
  let requests = 0;
  let lastError = "";
  const targetMs = targetSeconds * 1000;

  while (elapsedMs < targetMs && bytes < maxRoundBytes && requests < MAX_REQUESTS_PER_ROUND) {
    const requestBytes = Math.min(chunkBytes, maxRoundBytes - bytes);
    const start = rangeStart(requests, requestBytes, totalBytes);
    const sample = await measureOnce(url, requestBytes, TRANSFER_TIMEOUT_MS, start, baseHeaders);
    requests += 1;
    if (!sample.ok) {
      lastError = sample.error || `HTTP ${sample.status || "无响应"}`;
      break;
    }
    bytes += sample.bytes;
    elapsedMs += sample.elapsedMs;
    if (!totalBytes && sample.totalBytes) totalBytes = sample.totalBytes;
  }

  const capped = bytes >= maxRoundBytes && elapsedMs < targetMs;
  const reachedTime = elapsedMs >= targetMs;
  const sufficient = reachedTime || capped;
  const ok = sufficient && bytes >= 512 * 1024 && elapsedMs > 0;
  return {
    ok,
    bytes,
    elapsedMs,
    requests,
    capped,
    reachedTime,
    mbps: bytes > 0 && elapsedMs > 0 ? (bytes * 8 / 1e6) / (elapsedMs / 1000) : 0,
    error: ok ? "" : (lastError || `采样不足：${(elapsedMs / 1000).toFixed(2)} s / ${mib(bytes).toFixed(2)} MiB`),
  };
}

function formatSample(label, sample) {
  if (!sample || !sample.ok) return `${label}：失败 · ${(sample && sample.error) || "unknown"}`;
  const requests = sample.requests ? ` · ${sample.requests} 次 Range` : "";
  const capped = sample.capped ? " · 达流量上限" : "";
  return `${label}：${sample.mbps.toFixed(1)} Mbps · ${mib(sample.bytes).toFixed(2)} MiB / ${(sample.elapsedMs / 1000).toFixed(2)} s${requests}${capped}`;
}

function notify(title, subtitle, body) {
  console.log("[BiliBili CDN Redirect] ===== 当前 CDN 持续带宽 =====");
  console.log(body);
  console.log("[BiliBili CDN Redirect] ============================");
  $notification.post(title, subtitle, body);
}

(async () => {
  const options = args();
  const target = currentTarget(options);
  if (!target) {
    notify("🎯 当前 CDN 持续带宽", "没有可测速节点", "请先播放一个 Bilibili 视频，或在插件中选择有效的手动 CDN，然后再次运行。");
    $done();
    return;
  }

  const bvid = configuredBvid(options);
  if (!bvid) {
    notify("🎯 当前 CDN 持续带宽", "BV 号格式无效", `当前值：${String(options.test_bvid || "")}\n请输入类似 BV1eL4k6jEjd 的 BV 号。`);
    $done();
    return;
  }
  const targetSeconds = configuredTargetSeconds(options);

  const key = networkKey();
  const profile = isCellular()
    ? {
        name: "蜂窝",
        preflightBytes: 128 * 1024,
        calibrationBytes: 512 * 1024,
        minChunkBytes: 256 * 1024,
        maxChunkBytes: 4 * 1024 * 1024,
        maxRoundBytes: 20 * 1024 * 1024,
      }
    : {
        name: "Wi-Fi",
        preflightBytes: 256 * 1024,
        calibrationBytes: 1024 * 1024,
        minChunkBytes: 256 * 1024,
        maxChunkBytes: 8 * 1024 * 1024,
        maxRoundBytes: 64 * 1024 * 1024,
      };

  let donor = null;
  const startedAt = Date.now();
  try {
    donor = await freshDonor(bvid, target.family);

    console.log(`[BiliBili CDN Redirect] 手动持续带宽测速：${target.node} · family=${target.family} · ${profile.name} · DIRECT`);
    console.log(`[BiliBili CDN Redirect] 配置视频=${bvid} · 单轮目标=${targetSeconds}s · donor=${donor.source} · family=${donor.family}${donor.exactFamily ? "（同 family）" : "（跨 family）"} · headers=${Object.keys(donor.headers || {}).length ? "真实请求头" : "默认请求头"}`);
    console.log(`[BiliBili CDN Redirect] 轻量预检：${Math.round(profile.preflightBytes / 1024)} KiB · timeout=${PREFLIGHT_TIMEOUT_MS}ms`);

    let preflight = await preflightDonor(donor, target, profile);

    // A cross-family recent request is still useful as a cheap fallback, but if it
    // cannot be used on the target node, give the configured BV page one chance
    // to supply an exact-family URL before declaring the node unavailable.
    if (!preflight.ok && !donor.exactFamily) {
      try {
        const page = await pageDonor(bvid, target.family);
        if (page.exactFamily && page.url !== donor.url) {
          console.log("[BiliBili CDN Redirect] 跨 family donor 预检失败，改用配置 BV 的同 family playurl donor 重试。");
          const retry = await preflightDonor(page, target, profile);
          if (retry.ok) {
            donor = page;
            preflight = retry;
          } else {
            console.log(`[BiliBili CDN Redirect] 同 family page donor 预检仍失败：${preflightFailureMessage(page, target, retry)}`);
          }
        }
      } catch (pageError) {
        console.log(`[BiliBili CDN Redirect] 跨 family donor 失败后的 page donor 回退不可用：${pageError}`);
      }
    }

    if (!preflight.ok) throw new Error(preflightFailureMessage(donor, target, preflight));

    const testUrl = preflight.testUrl;
    const preflightSample = preflight.targetCheck;
    const calibration = await measureOnce(testUrl, profile.calibrationBytes, CALIBRATION_TIMEOUT_MS, 0, donor.headers);
    const referenceMbps = calibration.ok ? calibration.mbps : preflightSample.mbps;
    const rawChunkBytes = referenceMbps * 1e6 / 8 * CHUNK_TARGET_SECONDS;
    let chunkBytes = roundBytes(clamp(rawChunkBytes, profile.minChunkBytes, profile.maxChunkBytes));
    const totalBytes = calibration.totalBytes || preflightSample.totalBytes || 0;
    if (totalBytes > 0) chunkBytes = Math.min(chunkBytes, totalBytes);

    const rounds = [];
    for (let i = 0; i < ROUND_COUNT; i += 1) {
      const sample = await sustainedRound(testUrl, chunkBytes, targetSeconds, profile.maxRoundBytes, totalBytes, donor.headers);
      rounds.push(sample);
      console.log(`[BiliBili CDN Redirect] ${formatSample(`Round ${i + 1}`, sample)}`);
    }

    const good = rounds.filter((item) => item.ok && item.mbps > 0);
    if (good.length < 2) {
      throw new Error(`正式测量仅成功 ${good.length}/${ROUND_COUNT} 轮，结果不足以作为稳定带宽参考`);
    }

    const rates = good.map((item) => item.mbps);
    const med = median(rates);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const stability = med > 0 ? min / med * 100 : 0;
    const totalTraffic = preflightSample.bytes + calibration.bytes + rounds.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
    const elapsed = (Date.now() - startedAt) / 1000;

    const body = [
      `节点：${target.node}`,
      `family：${target.family} · 来源：${target.source}`,
      `网络：${key} · ${profile.name} · DIRECT`,
      `配置视频：${bvid}`,
      `donor：${donor.source} · ${donor.family}${donor.exactFamily ? "" : "（跨 family）"}`,
      `单轮目标：${targetSeconds.toFixed(1)} s · 单轮流量上限：${mib(profile.maxRoundBytes).toFixed(0)} MiB`,
      "",
      formatSample("预检（不计分）", preflightSample),
      formatSample("校准（不计分）", calibration),
      `持续请求块：约 ${mib(chunkBytes).toFixed(2)} MiB / 次`,
      ...rounds.map((item, index) => formatSample(`Round ${index + 1}`, item)),
      "",
      `持续带宽中位数：${med.toFixed(1)} Mbps`,
      `最低 / 最高：${min.toFixed(1)} / ${max.toFixed(1)} Mbps`,
      `稳定度（最低÷中位数）：${stability.toFixed(0)}%`,
      `成功：${good.length}/${ROUND_COUNT} · 实际流量：${mib(totalTraffic).toFixed(1)} MiB · 总耗时：${elapsed.toFixed(1)} s`,
      "",
      donor.exactFamily ? "donor 与当前 CDN family 一致。" : "注意：没有找到同 family donor，本次使用跨 family signed URL，结果仅供参考。",
      "本测试不会修改自动测速缓存或当前 CDN 选择。",
    ].join("\n");

    notify("🎯 当前 CDN 持续带宽", `${med.toFixed(1)} Mbps · ${target.node}`, body);
  } catch (error) {
    const body = [
      `节点：${target.node}`,
      `family：${target.family} · 来源：${target.source}`,
      `网络：${key}`,
      `测试视频：${bvid}`,
      `错误：${error}`,
      "",
      "测速不会修改自动测速缓存或当前 CDN 选择。",
    ].join("\n");
    notify("🎯 当前 CDN 持续带宽", "测速失败", body);
  } finally {
    $done();
  }
})();

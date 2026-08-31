const FAMILY_CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.family.v1";
const STATUS_KEY = "BiliBili.Redirect.CCBStyle.status.v1";
const AUTO_HEADER = "X-CCB-Speedtest";
const TEST_BVID = "BV1eL4k6jEjd";
const API_TIMEOUT_MS = 5000;
const WARMUP_TIMEOUT_MS = 5000;
const CALIBRATION_TIMEOUT_MS = 7000;
const ROUND_TIMEOUT_MS = 8000;
const TARGET_ROUND_SECONDS = 2.5;
const ROUND_COUNT = 3;

const API_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  Referer: "https://www.bilibili.com/",
  Origin: "https://www.bilibili.com",
  Accept: "application/json,text/plain,*/*",
  "Accept-Encoding": "identity",
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

async function getJson(url) {
  const { error, response, data } = await hardHttpGet({
    url,
    node: "DIRECT",
    headers: API_HEADERS,
    "auto-redirect": false,
    "auto-cookie": false,
  }, API_TIMEOUT_MS);
  if (error) throw new Error(String(error));
  const status = responseStatus(response);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  try {
    return JSON.parse(typeof data === "string" ? data : String(data || ""));
  } catch (error) {
    throw new Error(`JSON 解析失败: ${error}`);
  }
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

async function freshDonor(targetFamily) {
  const viewUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(TEST_BVID)}`;
  const view = await getJson(viewUrl);
  if (!view || view.code !== 0 || !view.data || !view.data.cid) {
    throw new Error(`获取测试视频信息失败: ${(view && view.message) || "unknown"}`);
  }
  const cid = view.data.cid;
  const playurlUrl = `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(TEST_BVID)}&cid=${encodeURIComponent(cid)}&qn=80&fnver=0&fnval=16&fourk=1&otype=json`;
  const play = await getJson(playurlUrl);
  if (!play || play.code !== 0) throw new Error(`获取测试媒体 URL 失败: ${(play && play.message) || "unknown"}`);
  const urls = mediaUrlsFromPlayurl(play);
  if (!urls.length) throw new Error("测试视频没有可用的 DASH/durl 媒体 URL");
  const matched = urls.find((url) => urlFamily(url) === targetFamily);
  return {
    url: matched || urls[0],
    family: urlFamily(matched || urls[0]),
    exactFamily: Boolean(matched),
    playurlUrl,
  };
}

function swapHost(raw, node) {
  const url = new URL(raw);
  url.protocol = "https:";
  url.hostname = node;
  url.port = "";
  return url.toString();
}

function binaryLength(data) {
  if (data == null) return 0;
  if (typeof data.byteLength === "number") return data.byteLength;
  if (typeof data.length === "number") return data.length;
  return 0;
}

async function measureOnce(url, requestedBytes, timeout) {
  const headers = {
    "User-Agent": API_HEADERS["User-Agent"],
    Referer: API_HEADERS.Referer,
    Origin: API_HEADERS.Origin,
    Accept: "*/*",
    "Accept-Encoding": "identity",
    Range: `bytes=0-${Math.max(1, requestedBytes) - 1}`,
    [AUTO_HEADER]: "1",
  };
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

function formatSample(label, sample) {
  if (!sample || !sample.ok) return `${label}：失败 · ${(sample && sample.error) || "unknown"}`;
  return `${label}：${sample.mbps.toFixed(1)} Mbps · ${mib(sample.bytes).toFixed(2)} MiB / ${(sample.elapsedMs / 1000).toFixed(2)} s`;
}

function restoreSyntheticPlayurlStatus(previousStatus, playurlUrl) {
  if (!playurlUrl) return;
  const key = networkKey();
  const map = readMap(STATUS_KEY);
  const current = map[key];
  if (!current || current.source !== "playurl-response" || current.requestUrl !== playurlUrl) return;
  if (previousStatus) map[key] = previousStatus;
  else delete map[key];
  writeMap(STATUS_KEY, map, 8);
}

function notify(title, subtitle, body) {
  console.log("[BiliBili Redirect] ===== 当前 CDN 持续带宽 =====");
  console.log(body);
  console.log("[BiliBili Redirect] ============================");
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

  const key = networkKey();
  const previousStatus = readMap(STATUS_KEY)[key] || null;
  const profile = isCellular()
    ? { name: "蜂窝", warmupBytes: 384 * 1024, calibrationBytes: 768 * 1024, minRoundBytes: 512 * 1024, maxRoundBytes: 4 * 1024 * 1024 }
    : { name: "Wi-Fi", warmupBytes: 512 * 1024, calibrationBytes: 1024 * 1024, minRoundBytes: 1024 * 1024, maxRoundBytes: 8 * 1024 * 1024 };

  let donor = null;
  const startedAt = Date.now();
  try {
    donor = await freshDonor(target.family);
    const testUrl = swapHost(donor.url, target.node);

    console.log(`[BiliBili Redirect] 手动持续带宽测速：${target.node} · family=${target.family} · ${profile.name} · DIRECT`);
    console.log(`[BiliBili Redirect] donor family=${donor.family}${donor.exactFamily ? "（同 family）" : "（跨 family fallback）"}`);

    const warmup = await measureOnce(testUrl, profile.warmupBytes, WARMUP_TIMEOUT_MS);
    if (!warmup.ok) throw new Error(`预热失败：${warmup.error}`);

    const calibration = await measureOnce(testUrl, profile.calibrationBytes, CALIBRATION_TIMEOUT_MS);
    const referenceMbps = calibration.ok ? calibration.mbps : warmup.mbps;
    const rawBytes = referenceMbps * 1e6 / 8 * TARGET_ROUND_SECONDS;
    const measureBytes = roundBytes(clamp(rawBytes, profile.minRoundBytes, profile.maxRoundBytes));

    const rounds = [];
    for (let i = 0; i < ROUND_COUNT; i += 1) {
      const sample = await measureOnce(testUrl, measureBytes, ROUND_TIMEOUT_MS);
      rounds.push(sample);
      console.log(`[BiliBili Redirect] ${formatSample(`Round ${i + 1}`, sample)}`);
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
    const totalBytes = warmup.bytes + calibration.bytes + rounds.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
    const elapsed = (Date.now() - startedAt) / 1000;

    const body = [
      `节点：${target.node}`,
      `family：${target.family} · 来源：${target.source}`,
      `网络：${key} · ${profile.name} · DIRECT`,
      `测试视频：${TEST_BVID} · donor=${donor.family}${donor.exactFamily ? "" : "（跨 family）"}`,
      "",
      formatSample("预热（不计分）", warmup),
      formatSample("校准（不计分）", calibration),
      `正式样本：${mib(measureBytes).toFixed(2)} MiB × ${ROUND_COUNT}`,
      ...rounds.map((item, index) => formatSample(`Round ${index + 1}`, item)),
      "",
      `持续带宽中位数：${med.toFixed(1)} Mbps`,
      `最低 / 最高：${min.toFixed(1)} / ${max.toFixed(1)} Mbps`,
      `稳定度（最低÷中位数）：${stability.toFixed(0)}%`,
      `成功：${good.length}/${ROUND_COUNT} · 实际流量：${mib(totalBytes).toFixed(1)} MiB · 总耗时：${elapsed.toFixed(1)} s`,
      "",
      "本测试不会修改自动测速缓存或当前 CDN 选择。",
    ].join("\n");

    notify("🎯 当前 CDN 持续带宽", `${med.toFixed(1)} Mbps · ${target.node}`, body);
  } catch (error) {
    const body = [
      `节点：${target.node}`,
      `family：${target.family} · 来源：${target.source}`,
      `网络：${key}`,
      `错误：${error}`,
      "",
      "测速不会修改自动测速缓存或当前 CDN 选择。",
    ].join("\n");
    notify("🎯 当前 CDN 持续带宽", "测速失败", body);
  } finally {
    restoreSyntheticPlayurlStatus(previousStatus, donor && donor.playurlUrl);
    $done();
  }
})();
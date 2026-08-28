const FAMILY_CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.family.v1";
const STATUS_KEY = "BiliBili.Redirect.CCBStyle.status.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ENGINE_VERSION = 11;

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
  map[key] = { state, at: Date.now(), network: key, source: "playurl-response", ...extra };
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

function describeMediaUrl(raw) {
  try {
    const url = new URL(raw);
    const hostFamily = classifyHostFamily(url.hostname);
    const osFamily = normalizeOsFamily(url.searchParams.get("os"));
    return {
      url: raw,
      host: url.hostname,
      family: osFamily || hostFamily,
    };
  } catch (_) {
    return null;
  }
}

function loadFamilyRanking(family) {
  const bucket = readMap(FAMILY_CACHE_KEY)[networkKey()];
  if (!bucket || typeof bucket !== "object" || !bucket.families) return null;
  const entry = bucket.families[family];
  if (!entry || typeof entry !== "object") return null;
  if (entry.engineVersion !== ENGINE_VERSION) return null;
  if (typeof entry.at !== "number" || Date.now() - entry.at > CACHE_TTL_MS) return null;
  if (typeof entry.best !== "string" || !entry.best) return null;
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

function processMediaPayload(payload, resolveTarget) {
  const sampleUrls = [];
  const sampleSeen = new Set();
  const appliedFamilies = new Set();
  const pendingFamilies = new Set();
  let changed = 0;
  const seenContainers = new Set();

  const remember = (raw) => {
    if (typeof raw !== "string" || !/^https?:\/\//i.test(raw) || sampleSeen.has(raw)) return;
    sampleSeen.add(raw);
    sampleUrls.push(raw);
  };

  const rewriteOne = (raw) => {
    remember(raw);
    if (typeof resolveTarget !== "function") return raw;
    const described = describeMediaUrl(raw);
    const resolved = resolveTarget(raw, described);
    const target = resolved && resolved.target;
    const family = (resolved && resolved.family) || (described && described.family) || "unknown";
    if (!target) {
      pendingFamilies.add(family);
      return raw;
    }
    const next = rewriteMediaUrl(raw, target);
    if (next !== raw) {
      changed += 1;
      appliedFamilies.add(family);
    }
    return next;
  };

  const rewriteField = (object, key) => {
    if (!object || typeof object !== "object" || !(key in object)) return;
    const value = object[key];
    if (typeof value === "string") {
      object[key] = rewriteOne(value);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === "string") value[index] = rewriteOne(item);
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
  return {
    sampleUrls,
    changed,
    appliedFamilies: [...appliedFamilies].filter((family) => family !== "unknown"),
    pendingFamilies: [...pendingFamilies].filter((family) => family !== "unknown"),
  };
}

try {
  const options = args();
  const cdn = options.cdn;
  const auto = isAutoEnabled(options.auto);
  const requestUrl = ($request && $request.url) || "";
  console.log(`[BiliBili Redirect] playurl response 命中: ${requestUrl}`);

  if (!$response || typeof $response.body !== "string" || !$response.body) {
    writeStatus("error", { auto, cdn, message: "playurl 响应没有可读取的 JSON body", requestUrl });
    $done({});
  } else {
    let payload;
    try {
      payload = JSON.parse($response.body);
    } catch (error) {
      writeStatus("error", { auto, cdn, message: `playurl JSON 解析失败: ${error}`, requestUrl });
      $done({});
      payload = null;
    }

    if (payload) {
      const initial = processMediaPayload(payload, null);
      if (!initial.sampleUrls.length) {
        writeStatus("waiting", { auto, cdn, message: "playurl 已命中，但响应中没有找到 DASH/durl 媒体 URL", requestUrl });
        console.log("[BiliBili Redirect] playurl 响应中未找到媒体 URL，保留原响应");
        $done({});
      } else if (!auto) {
        if (typeof cdn !== "string" || !cdn || isSeparator(cdn)) {
          writeStatus("error", { auto, cdn, message: "手动 CDN 无效或选中了地区分隔项", requestUrl });
          $done({});
        } else {
          const result = processMediaPayload(payload, (_raw, described) => ({
            target: cdn,
            family: described ? described.family : "manual",
          }));
          writeStatus("manual", { auto, cdn, selected: cdn, changed: result.changed, requestUrl });
          console.log(`[BiliBili Redirect] playurl 手动改写 ${result.changed} 条媒体 URL -> ${cdn}`);
          $done({ body: JSON.stringify(payload) });
        }
      } else {
        const memo = new Map();
        const result = processMediaPayload(payload, (_raw, described) => {
          const family = described ? described.family : "unknown";
          if (!memo.has(family)) memo.set(family, loadFamilyRanking(family));
          const entry = memo.get(family);
          return { target: entry ? entry.best : null, family };
        });

        const applied = result.appliedFamilies;
        const pending = result.pendingFamilies;
        const state = result.changed > 0 ? "cached" : "waiting";
        writeStatus(state, {
          auto,
          cdn,
          changed: result.changed,
          sampleCount: result.sampleUrls.length,
          sampleFamilies: [...new Set(result.sampleUrls.map((raw) => {
            const described = describeMediaUrl(raw);
            return described ? described.family : "unknown";
          }))].filter((family) => family !== "unknown"),
          requestUrl,
          message: [
            applied.length ? `playurl 已应用现有 family 缓存：${applied.join(" / ")}` : "playurl 没有可直接应用的有效 family 缓存",
            pending.length ? `未缓存 family ${pending.join(" / ")} 交给 CDN request fallback 触发 v11 自动测速` : "",
          ].filter(Boolean).join("；"),
        });
        console.log(`[BiliBili Redirect] playurl 自动模式：应用缓存 ${result.changed} 条；${pending.length ? `待 request fallback 测速 family=${pending.join("/")}` : "全部命中现有缓存"}`);
        if (result.changed > 0) $done({ body: JSON.stringify(payload) });
        else $done({});
      }
    }
  }
} catch (error) {
  writeStatus("error", { message: `未处理异常: ${error}` });
  console.log(`[BiliBili Redirect] playurl 未处理异常：${error}`);
  $done({});
}

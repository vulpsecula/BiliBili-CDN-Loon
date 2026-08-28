const CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.v1";
const STATUS_KEY = "BiliBili.Redirect.CCBStyle.status.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const STALE_TEST_MS = 22 * 1000;

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

function latestEntry(map) {
  return Object.values(map || {})
    .filter((item) => item && typeof item.at === "number")
    .sort((a, b) => b.at - a.at)[0] || null;
}

function formatTime(timestamp) {
  if (!timestamp) return "未知";
  try {
    return new Date(timestamp).toLocaleString();
  } catch (_) {
    return String(timestamp);
  }
}

function formatAge(timestamp) {
  if (!timestamp) return "未知";
  const sec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  return `${hour} 小时前`;
}

function sourceName(source) {
  if (source === "playurl-response") return "playurl 响应";
  if (source === "cdn-request") return "CDN 请求 fallback";
  return source || "未知";
}

function stateName(state) {
  return {
    manual: "手动模式",
    waiting: "等待媒体 URL",
    testing: "测速中",
    success: "测速成功",
    cached: "使用测速缓存",
    error: "测速失败",
  }[state] || state || "未知";
}

function line(item, index) {
  const stage = item.stage === 2 ? "精测" : "初筛";
  const family = item.familyMatched === undefined
    ? ""
    : ` · ${item.familyMatched ? "同族样本" : "跨族样本"}`;
  return `${index + 1}. ${item.node} — ${Number(item.mbps || 0).toFixed(1)} Mbps (${item.region || "未知"} · ${stage}${family})`;
}

function failureLine(item, index) {
  const stage = item.stage === 2 ? "精测" : "初筛";
  const family = item.familyMatched ? "同族" : "跨族";
  const status = item.status ? ` HTTP ${item.status}` : "";
  const sample = item.sampleFamily ? ` ${item.sampleFamily}→${item.nodeFamily || "?"}` : "";
  const error = item.error ? ` · ${item.error}` : "";
  return `F${index + 1}. ${item.node} — ${item.kind || "other"}${status} (${item.region || "未知"} · ${stage} · ${family}${sample})${error}`;
}

function statsLines(stats) {
  if (!stats || typeof stats !== "object") return [];
  return [
    `测速尝试：成功 ${stats.ok || 0}/${stats.attempts || 0}`,
    `初筛：${stats.stage1Ok || 0}/${stats.stage1Attempts || 0}；精测：${stats.stage2Ok || 0}/${stats.stage2Attempts || 0}`,
    `失败：超时 ${stats.timeout || 0} · HTTP ${stats.http || 0} · 空响应 ${stats.empty || 0} · 预算 ${stats.budget || 0} · 其他 ${stats.other || 0}`,
    stats.familyMatchedAttempts !== undefined
      ? `同 family 样本：成功 ${stats.familyMatchedOk || 0}/${stats.familyMatchedAttempts || 0}`
      : null,
  ].filter(Boolean);
}

function notify(subtitle, body, clipboard) {
  console.log("[BiliBili Redirect] ===== 测速状态 / 结果 =====");
  console.log(body);
  console.log("[BiliBili Redirect] ==========================");
  try {
    $notification.post(
      "📺 BiliBili CDN 测速状态 / 结果",
      subtitle,
      body,
      clipboard ? { clipboard } : null,
    );
  } catch (_) {
    $notification.post("📺 BiliBili CDN 测速状态 / 结果", subtitle, body);
  }
}

try {
  const options = args();
  const auto = isAutoEnabled(options.auto);
  const manualCdn = options.cdn || "未设置";
  const key = networkKey();
  const cacheMap = readMap(CACHE_KEY);
  const statusMap = readMap(STATUS_KEY);
  const currentCache = cacheMap[key] || null;
  const currentStatus = statusMap[key] || null;
  const recentCache = latestEntry(cacheMap);
  const recentStatus = latestEntry(statusMap);
  const cache = currentCache || recentCache;
  const status = currentStatus || recentStatus;
  const validCurrentCache =
    currentCache &&
    typeof currentCache.at === "number" &&
    Date.now() - currentCache.at <= CACHE_TTL_MS;

  const common = [
    `自动测速：${auto ? "已开启" : "已关闭"}`,
    `手动 CDN：${manualCdn}`,
    `当前网络：${key}`,
  ];

  if (validCurrentCache && currentCache.best) {
    const ranking = Array.isArray(currentCache.ranking) ? currentCache.ranking : [];
    const failures = Array.isArray(currentCache.failures) ? currentCache.failures : [];
    const top = ranking.slice(0, 10);
    const sampleFamilies = Array.isArray(currentCache.sampleFamilies)
      ? currentCache.sampleFamilies
      : [];
    const fallbackWarning =
      currentCache.source === "cdn-request" &&
      Number(currentCache.sampleCount || 0) <= 1
        ? "说明：fallback 只有一个 signed URL；跨 family 失败不能解释为节点慢，只能解释为该样本不兼容或在时限内未完成。"
        : null;

    const body = [
      ...common,
      "状态：可用缓存",
      `最快：${currentCache.best}`,
      `速度：${Number(currentCache.bestMbps || 0).toFixed(1)} Mbps`,
      `地区：${currentCache.bestRegion || "未知"}`,
      `来源：${sourceName(currentCache.source)}`,
      currentCache.elapsedMs !== undefined
        ? `测速耗时：${(Number(currentCache.elapsedMs) / 1000).toFixed(1)} 秒`
        : null,
      currentCache.sampleCount !== undefined
        ? `测速样本：${currentCache.sampleCount} 条${sampleFamilies.length ? `（${sampleFamilies.join(" / ")}）` : ""}`
        : null,
      ...statsLines(currentCache.stats),
      `测速时间：${formatTime(currentCache.at)}（${formatAge(currentCache.at)}）`,
      fallbackWarning,
      "",
      ...top.map(line),
      failures.length ? `\n失败诊断已记录 ${failures.length} 条；完整列表已写入剪贴板/日志。` : null,
    ].filter(Boolean).join("\n");

    const full = [
      "==== 成功排名 ====",
      ...(ranking.length ? ranking.map(line) : ["无成功排名"]),
      "",
      "==== 失败诊断 ====",
      ...(failures.length ? failures.map(failureLine) : ["无失败记录"]),
    ].join("\n");

    console.log(full);
    notify(
      `${Number(currentCache.bestMbps || 0).toFixed(1)} Mbps · ${currentCache.bestRegion || "未知地区"}`,
      body,
      full,
    );
    $done();
  } else if (!auto) {
    const body = [
      ...common,
      "状态：手动模式",
      "自动测速关闭时始终使用上方手动 CDN。",
      cache && cache.best
        ? `最近测速：${cache.best} · ${Number(cache.bestMbps || 0).toFixed(1)} Mbps（不会在手动模式使用）`
        : "最近测速：无",
    ].join("\n");
    notify("手动模式", body);
    $done();
  } else if (status) {
    const sameNetwork = status.network === key;
    const testStart = status.startedAt || status.at;
    const testingAge =
      status.state === "testing" && testStart ? Date.now() - testStart : 0;
    const staleTesting =
      sameNetwork && status.state === "testing" && testingAge > STALE_TEST_MS;
    const shownState = staleTesting ? "测速可能已超时" : stateName(status.state);
    const sampleFamilies = Array.isArray(status.sampleFamilies)
      ? status.sampleFamilies
      : [];

    const body = [
      ...common,
      `状态：${shownState}${sameNetwork ? "" : "（最近其他网络）"}`,
      `来源：${sourceName(status.source)}`,
      status.phase ? `阶段：${status.phase}` : null,
      status.startedAt
        ? `开始：${formatTime(status.startedAt)}（${formatAge(status.startedAt)}）`
        : null,
      `状态更新：${formatTime(status.at)}（${formatAge(status.at)}）`,
      status.sampleHost ? `测速样本：${status.sampleHost}` : null,
      status.sampleCount !== undefined
        ? `样本数量：${status.sampleCount}${sampleFamilies.length ? `（${sampleFamilies.join(" / ")}）` : ""}`
        : null,
      status.selected ? `实际选择：${status.selected}` : null,
      status.bestMbps !== undefined
        ? `速度：${Number(status.bestMbps || 0).toFixed(1)} Mbps`
        : null,
      status.bestRegion ? `地区：${status.bestRegion}` : null,
      status.elapsedMs !== undefined
        ? `耗时：${(Number(status.elapsedMs) / 1000).toFixed(1)} 秒`
        : null,
      ...statsLines(status.stats),
      status.message ? `说明：${status.message}` : null,
      staleTesting
        ? "诊断：测速已超过约 22 秒仍未结束，上一轮可能被 Loon 脚本超时终止。"
        : null,
      !sameNetwork ? "当前网络尚没有独立测速缓存。" : null,
    ].filter(Boolean).join("\n");

    notify(shownState, body);
    $done();
  } else if (cache && cache.best) {
    const expired =
      typeof cache.at === "number" && Date.now() - cache.at > CACHE_TTL_MS;
    const body = [
      ...common,
      "状态：当前网络没有可用缓存",
      `最近记录：${cache.best} · ${Number(cache.bestMbps || 0).toFixed(1)} Mbps`,
      `记录网络：${cache.network || "未知"}`,
      `记录时间：${formatTime(cache.at)}（${expired ? "已过期" : formatAge(cache.at)}）`,
      "请播放一个普通视频触发当前网络测速。",
    ].join("\n");
    notify("等待当前网络测速", body);
    $done();
  } else {
    const body = [
      ...common,
      "状态：未检测到测速触发",
      "没有发现 playurl 响应或 CDN 请求写入的状态。",
      "请播放一个普通视频；再次运行这里即可看到触发来源、样本 family、成功/失败数量及失败原因。",
    ].join("\n");
    notify("等待触发", body);
    $done();
  }
} catch (error) {
  const message = `读取测速状态失败：${error}`;
  console.log(`[BiliBili Redirect] ${message}`);
  $notification.post("📺 BiliBili CDN 测速状态 / 结果", "读取失败", message);
  $done();
}

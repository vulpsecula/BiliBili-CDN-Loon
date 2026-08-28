const FAMILY_CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.family.v1";
const LEGACY_CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.v1";
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
    try { out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1)); } catch (_) {}
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

function formatTime(timestamp) {
  if (!timestamp) return "未知";
  try { return new Date(timestamp).toLocaleString(); } catch (_) { return String(timestamp); }
}

function formatAge(timestamp) {
  if (!timestamp) return "未知";
  const sec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  return `${Math.floor(min / 60)} 小时前`;
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

function stageName(item) {
  if (item && item.stageName) return item.stageName;
  if (item && item.stage === 3) return "串行确认";
  if (item && item.stage === 2) return "重试";
  return "首测";
}

function line(item, index) {
  const baseline = item.baseline ? " · 原始基线" : "";
  return `${index + 1}. ${item.node} — ${Number(item.mbps || 0).toFixed(1)} Mbps (${item.region || "未知"} · ${stageName(item)}${baseline})`;
}

function failureLine(item, index) {
  const status = item.status ? ` HTTP ${item.status}` : "";
  const error = item.error ? ` · ${item.error}` : "";
  return `F${index + 1}. ${item.node} — ${item.kind || "other"}${status} (${item.region || "未知"} · ${stageName(item)})${error}`;
}

function statsLines(stats) {
  if (!stats || typeof stats !== "object" || !stats.attempts) return [];
  if (stats.firstAttempts !== undefined || stats.retryAttempts !== undefined || stats.confirmAttempts !== undefined) {
    return [
      `测速尝试：成功 ${stats.ok || 0}/${stats.attempts || 0}`,
      `首测：${stats.firstOk || 0}/${stats.firstAttempts || 0}；重试：${stats.retryOk || 0}/${stats.retryAttempts || 0}；串行确认：${stats.confirmOk || 0}/${stats.confirmAttempts || 0}`,
      `失败：DNS ${stats.dns || 0} · 超时 ${stats.timeout || 0} · HTTP ${stats.http || 0} · 其他 ${stats.other || 0}`,
    ];
  }
  return [
    `测速尝试：成功 ${stats.ok || 0}/${stats.attempts || 0}`,
    `初筛：${stats.stage1Ok || 0}/${stats.stage1Attempts || 0}；精测：${stats.stage2Ok || 0}/${stats.stage2Attempts || 0}`,
    `失败：DNS ${stats.dns || 0} · 超时 ${stats.timeout || 0} · HTTP ${stats.http || 0} · 其他 ${stats.other || 0}`,
  ];
}

function validEntry(entry) {
  return Boolean(
    entry && typeof entry === "object" &&
    typeof entry.at === "number" && Date.now() - entry.at <= CACHE_TTL_MS &&
    typeof entry.best === "string" && entry.best
  );
}

function familyEntriesForNetwork(key) {
  const bucket = readMap(FAMILY_CACHE_KEY)[key];
  if (!bucket || typeof bucket !== "object" || !bucket.families) return [];
  return Object.entries(bucket.families)
    .map(([family, entry]) => ({ family, entry }))
    .filter(({ entry }) => validEntry(entry))
    .sort((a, b) => b.entry.at - a.entry.at);
}

function latestLegacyEntry(key) {
  const entry = readMap(LEGACY_CACHE_KEY)[key];
  return validEntry(entry) ? entry : null;
}

function familySummary(item) {
  const { family, entry } = item;
  if (entry.mode === "single-candidate-passthrough" || !(entry.bestMbps > 0)) {
    return `${family} 自动选择：${entry.best}（单候选直通，${formatAge(entry.at)}）`;
  }
  return `${family} 自动选择：${entry.best} · ${Number(entry.bestMbps).toFixed(1)} Mbps（${formatAge(entry.at)}）`;
}

function actualRequestSummary(status) {
  if (!status || !status.selected) return null;
  const family = status.probeFamily || (status.auto === false ? "manual" : "unknown");
  return `${family} → ${status.selected}`;
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
  const familyEntries = familyEntriesForNetwork(key);
  const legacy = latestLegacyEntry(key);
  const status = readMap(STATUS_KEY)[key] || null;
  const actualRequest = actualRequestSummary(status);

  const common = [
    `自动测速：${auto ? "已开启" : "已关闭"}`,
    `手动 CDN：${manualCdn}`,
    `当前网络：${key}`,
    actualRequest ? `最近实际请求：${actualRequest}` : null,
  ].filter(Boolean);

  if (!auto) {
    const recent = familyEntries[0] && familyEntries[0].entry;
    const body = [
      ...common,
      "状态：手动模式",
      "自动测速关闭时始终使用上方手动 CDN。",
      recent ? `最近自动测速：${recent.probeFamily || "unknown"} → ${recent.best}` : "最近自动测速：无",
    ].join("\n");
    notify("手动模式", body);
    $done();
  } else if (familyEntries.length) {
    const latest = familyEntries[0].entry;
    const ranking = Array.isArray(latest.ranking) ? latest.ranking : [];
    const failures = Array.isArray(latest.failures) ? latest.failures : [];
    const body = [
      ...common,
      "状态：按 CDN family 独立缓存",
      `已缓存 family：${familyEntries.length}`,
      ...familyEntries.map(familySummary),
      "",
      `最近测速 family：${latest.probeFamily || familyEntries[0].family}`,
      latest.mode === "single-candidate-passthrough"
        ? "最近测速结果：只有原始 CDN，无需测速，已静默直通"
        : `最近测速选中：${latest.best} · ${Number(latest.bestMbps || 0).toFixed(1)} Mbps`,
      `来源：${sourceName(latest.source)}`,
      latest.mode ? `测速模式：${latest.mode}` : null,
      latest.elapsedMs !== undefined ? `测速耗时：${(Number(latest.elapsedMs) / 1000).toFixed(1)} 秒` : null,
      ...statsLines(latest.stats),
      `记录时间：${formatTime(latest.at)}（${formatAge(latest.at)}）`,
      ranking.length ? "" : null,
      ...ranking.slice(0, 10).map(line),
      failures.length ? `\n失败诊断 ${failures.length} 条，完整列表已写入剪贴板/日志。` : null,
    ].filter(Boolean).join("\n");

    const full = [
      "==== Family 缓存 ====",
      ...familyEntries.map(familySummary),
      "",
      actualRequest ? `==== 最近实际请求：${actualRequest} ====` : null,
      `==== 最近测速：${latest.probeFamily || "unknown"} ====`,
      ...(ranking.length ? ranking.map(line) : ["无测速排名（单候选直通）"]),
      "",
      "==== 失败诊断 ====",
      ...(failures.length ? failures.map(failureLine) : ["无失败记录"]),
    ].filter(Boolean).join("\n");
    console.log(full);
    notify(`${latest.probeFamily || "CDN"} · ${latest.best}`, body, full);
    $done();
  } else if (legacy) {
    const ranking = Array.isArray(legacy.ranking) ? legacy.ranking : [];
    const body = [
      ...common,
      "状态：旧版/Playurl 缓存",
      `最快：${legacy.best}`,
      `速度：${Number(legacy.bestMbps || 0).toFixed(1)} Mbps`,
      `来源：${sourceName(legacy.source)}`,
      `测速时间：${formatTime(legacy.at)}（${formatAge(legacy.at)}）`,
      "新 fallback 会按 CDN family 建立独立缓存。",
      "",
      ...ranking.slice(0, 10).map(line),
    ].filter(Boolean).join("\n");
    notify("旧版缓存", body);
    $done();
  } else if (status) {
    const testStart = status.startedAt || status.at;
    const testingAge = status.state === "testing" && testStart ? Date.now() - testStart : 0;
    const staleTesting = status.state === "testing" && testingAge > STALE_TEST_MS;
    const shownState = staleTesting ? "测速可能已超时" : stateName(status.state);
    const body = [
      ...common,
      `状态：${shownState}`,
      `来源：${sourceName(status.source)}`,
      status.phase ? `阶段：${status.phase}` : null,
      status.probeFamily ? `当前 family：${status.probeFamily}` : null,
      status.startedAt ? `开始：${formatTime(status.startedAt)}（${formatAge(status.startedAt)}）` : null,
      `状态更新：${formatTime(status.at)}（${formatAge(status.at)}）`,
      actualRequest ? `实际请求：${actualRequest}` : null,
      status.bestMbps !== undefined ? `速度：${Number(status.bestMbps || 0).toFixed(1)} Mbps` : null,
      ...statsLines(status.stats),
      status.message ? `说明：${status.message}` : null,
      staleTesting ? "诊断：本轮测速超过预期时间，可能被 Loon 脚本上限终止。" : null,
    ].filter(Boolean).join("\n");
    notify(shownState, body);
    $done();
  } else {
    const body = [
      ...common,
      "状态：未检测到测速触发",
      "播放一个普通视频后再次运行这里即可看到各 CDN family 的独立缓存。",
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
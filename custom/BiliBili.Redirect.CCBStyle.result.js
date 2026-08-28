const CACHE_KEY = "BiliBili.Redirect.CCBStyle.speed.v1";

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

function formatTime(timestamp) {
  if (!timestamp) return "未知";
  try { return new Date(timestamp).toLocaleString(); } catch (_) { return String(timestamp); }
}

function line(item, index) {
  return `${index + 1}. ${item.node} — ${Number(item.mbps || 0).toFixed(1)} Mbps (${item.region || "未知"})`;
}

try {
  const raw = $persistentStore.read(CACHE_KEY);
  const map = raw ? JSON.parse(raw) : {};
  const currentKey = networkKey();
  let entry = map && map[currentKey];

  if (!entry && map && typeof map === "object") {
    entry = Object.values(map)
      .filter((item) => item && typeof item.at === "number")
      .sort((a, b) => b.at - a.at)[0];
  }

  if (!entry || !entry.best) {
    $notification.post(
      "📺 BiliBili CDN 测速结果",
      "暂无缓存",
      "请在插件中开启「自动测速」后播放一次普通视频。",
    );
    $done();
  } else {
    const ranking = Array.isArray(entry.ranking) ? entry.ranking : [];
    const top = ranking.slice(0, 10);
    const body = [
      `最快：${entry.best}`,
      `速度：${Number(entry.bestMbps || 0).toFixed(1)} Mbps`,
      `地区：${entry.bestRegion || "未知"}`,
      `时间：${formatTime(entry.at)}`,
      "",
      ...top.map(line),
    ].join("\n");
    const full = ranking.length ? ranking.map(line).join("\n") : body;

    console.log(`[BiliBili Redirect] 测速缓存 ${entry.network || ""} @ ${formatTime(entry.at)}`);
    console.log(full);
    try {
      $notification.post(
        "📺 BiliBili CDN 测速结果",
        `${Number(entry.bestMbps || 0).toFixed(1)} Mbps · ${entry.bestRegion || "未知地区"}`,
        body,
        { clipboard: full },
      );
    } catch (_) {
      $notification.post("📺 BiliBili CDN 测速结果", entry.best, body);
    }
    $done();
  }
} catch (error) {
  console.log(`[BiliBili Redirect] 读取测速结果失败：${error}`);
  $notification.post("📺 BiliBili CDN 测速结果", "读取失败", String(error));
  $done();
}

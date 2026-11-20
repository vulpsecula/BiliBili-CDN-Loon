// Invalidate only the active network's CDN rankings after a Loon network change.
// No HTTP request or speed test runs here; the next playback selects as needed.
const FAMILY_CACHE_KEY = "BiliBili.CDN.Redirect.Loon.speed.family.v1";
const STATUS_KEY = "BiliBili.CDN.Redirect.Loon.status.v1";

function networkKey() {
  try {
    const cfg = JSON.parse($config.getConfig());
    const ssid = cfg && cfg.ssid ? String(cfg.ssid) : "cellular-or-unknown";
    const mode = cfg && cfg.running_model !== undefined ? String(cfg.running_model) : "unknown";
    return `${ssid}|mode=${mode}`;
  } catch (_) {
    return "unknown";
  }
}

function readMap(key) {
  try {
    const raw = $persistentStore.read(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

try {
  const key = networkKey();
  const cache = readMap(FAMILY_CACHE_KEY);
  const hadRanking = Object.prototype.hasOwnProperty.call(cache, key);
  if (hadRanking) {
    delete cache[key];
    $persistentStore.write(JSON.stringify(cache), FAMILY_CACHE_KEY);
  }

  const statuses = readMap(STATUS_KEY);
  statuses[key] = {
    state: "waiting",
    at: Date.now(),
    network: key,
    source: "network-changed",
    message: hadRanking
      ? "网络环境变化：本网络的自动测速缓存已失效，下次播放时按需重新评估。"
      : "网络环境变化：本网络没有待失效的测速缓存，下次播放时按需评估。",
  };
  const recent = Object.entries(statuses)
    .sort((a, b) => Number((b[1] && b[1].at) || 0) - Number((a[1] && a[1].at) || 0))
    .slice(0, 8);
  $persistentStore.write(JSON.stringify(Object.fromEntries(recent)), STATUS_KEY);
  console.log(`[BiliBili CDN Redirect] 网络变化：${key}，失效缓存=${hadRanking}；不主动测速`);
} catch (error) {
  console.log(`[BiliBili CDN Redirect] 网络变化处理失败：${error}`);
} finally {
  $done();
}

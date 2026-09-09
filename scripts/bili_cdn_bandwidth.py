#!/usr/bin/env python3
"""Bilibili CDN sustained-bandwidth benchmark.

Tests nodes serially. Each test discards a warm-up period, then measures a
sustained window. Short media objects are requested repeatedly through one
connection pool so fast nodes are not penalised for reaching EOF early.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
import statistics
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx

CDN_JSON_URL = "https://raw.githubusercontent.com/Kanda-Akihito-Kun/ccb/refs/heads/main/data/cdn.json"
DEFAULT_PIN = "upos-sz-estgcos.bilivideo.com"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36"
BASE_HEADERS = {
    "User-Agent": UA,
    "Referer": "https://www.bilibili.com/",
    "Origin": "https://www.bilibili.com",
    "Accept": "*/*",
    "Accept-Encoding": "identity",
}
CHUNK_SIZE = 128 * 1024
BUCKET_SECONDS = 0.5


@dataclass
class Sample:
    phase: str
    round: int
    host: str
    region: str
    ok: bool
    mbps: float = 0.0
    tail_mbps: float = 0.0
    peak_mbps: float = 0.0
    ttfb_ms: float = 0.0
    measure_seconds: float = 0.0
    measured_bytes: int = 0
    requests: int = 0
    http_status: int = 0
    ramp_ratio: float = 0.0
    extended: bool = False
    error: str = ""


def get_json(url: str, timeout: float, **kwargs):
    with httpx.Client(timeout=timeout, follow_redirects=True, trust_env=False) as client:
        response = client.get(url, headers=BASE_HEADERS, **kwargs)
        response.raise_for_status()
        return response.json()


def valid_media_url(url: str) -> bool:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    return parsed.scheme in {"http", "https"} and (parsed.hostname or "").lower().endswith(".bilivideo.com")


def swap_host(url: str, host: str) -> str:
    parsed = urlsplit(url)
    netloc = f"{host}:{parsed.port}" if parsed.port else host
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, ""))


def collect_urls(value):
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"baseUrl", "base_url", "url"} and isinstance(item, str):
                found.append(item)
            elif key in {"backupUrl", "backup_url", "backup_url_list"} and isinstance(item, list):
                found.extend(x for x in item if isinstance(x, str))
            elif isinstance(item, (dict, list)):
                found.extend(collect_urls(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(collect_urls(item))
    return found


def media_url_from_bvid(bvid: str, timeout: float) -> str:
    if not re.fullmatch(r"BV[0-9A-Za-z]+", bvid):
        raise SystemExit("BVID 格式不正确")
    view = get_json(f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}", timeout)
    if view.get("code") != 0:
        raise SystemExit(f"获取视频信息失败: {view.get('message')}")
    play = get_json(
        "https://api.bilibili.com/x/player/playurl",
        timeout,
        params={
            "bvid": bvid,
            "cid": view["data"]["cid"],
            "qn": 80,
            "fnver": 0,
            "fnval": 16,
            "fourk": 1,
            "otype": "json",
        },
    )
    if play.get("code") != 0:
        raise SystemExit("获取播放 URL 失败，请改用 --media-url。")
    data = play.get("data") or {}
    videos = list(((data.get("dash") or {}).get("video") or []))
    videos.sort(key=lambda item: item.get("bandwidth") or 0, reverse=True)
    candidates = []
    for item in videos:
        candidates.extend(collect_urls(item))
    candidates.extend(collect_urls(data))
    for url in candidates:
        host = (urlsplit(url).hostname or "").lower()
        if valid_media_url(url) and host != "upos-sz-mirror14b.bilivideo.com":
            return url
    raise SystemExit("没有找到可换 host 的 bilivideo.com 媒体 URL，请使用 --media-url。")


def load_nodes(regions: list[str] | None, timeout: float):
    data = get_json(CDN_JSON_URL, timeout)
    wanted = set(regions or [])
    unknown = wanted - set(data)
    if unknown:
        raise SystemExit("未知地区: " + ", ".join(sorted(unknown)))
    nodes, seen = [], set()
    for region, hosts in data.items():
        if wanted and region not in wanted:
            continue
        for raw_host in hosts:
            host = str(raw_host).strip().lower()
            if not host.endswith(".bilivideo.com") or host in seen:
                continue
            seen.add(host)
            nodes.append((host, region))
    return nodes


def content_total(value: str | None):
    match = re.search(r"/(\d+|\*)$", value or "")
    return None if not match or match.group(1) == "*" else int(match.group(1))


def discover_total(donor_url: str, timeout: float) -> int | None:
    headers = dict(BASE_HEADERS)
    headers["Range"] = "bytes=0-0"
    with httpx.Client(timeout=timeout, follow_redirects=False, trust_env=False) as client:
        response = client.get(donor_url, headers=headers)
        if response.status_code not in {200, 206}:
            return None
        return content_total(response.headers.get("Content-Range")) or int(response.headers.get("Content-Length") or 0) or None


def bucket_stats(buckets: dict[int, int]) -> tuple[float, float, float]:
    if not buckets:
        return 0.0, 0.0, 0.0
    count = max(buckets) + 1
    rates = [buckets.get(i, 0) * 8 / BUCKET_SECONDS / 1_000_000 for i in range(count)]
    if not any(rates):
        return 0.0, 0.0, 0.0
    # The last bucket is normally only a few milliseconds wide because the
    # loop stops just after crossing the deadline.  It is not a complete
    # 0.5-second sample and would make an otherwise fast node look as if its
    # tail collapsed, so use only completed buckets for ramp/tail statistics.
    complete = rates[:-1] if len(rates) > 1 else rates
    head = statistics.median(complete[: min(2, len(complete))])
    tail = statistics.median(complete[-min(2, len(complete)) :])
    ramp = tail / head if head > 0.01 else (99.0 if tail > 0 else 0.0)
    return tail, max(rates), ramp


def test_one(
    host: str,
    region: str,
    donor_url: str,
    total: int | None,
    *,
    phase: str,
    round_no: int,
    warmup: float,
    measure: float,
    extend: float,
    ramp_threshold: float,
    connect_timeout: float,
    read_timeout: float,
    range_mib: int,
) -> Sample:
    url = swap_host(donor_url, host)
    range_bytes = min(range_mib * 1024 * 1024, total) if total else range_mib * 1024 * 1024
    headers = dict(BASE_HEADERS)
    headers["Range"] = f"bytes=0-{max(1, range_bytes) - 1}"
    timeout = httpx.Timeout(connect=connect_timeout, read=read_timeout, write=connect_timeout, pool=connect_timeout)
    began = time.perf_counter()
    first_byte = warm_end = deadline = None
    measured = request_count = status = 0
    buckets: dict[int, int] = {}
    did_extend = False
    try:
        with httpx.Client(http2=True, follow_redirects=False, timeout=timeout, trust_env=False) as client:
            done = False
            while not done:
                request_count += 1
                with client.stream("GET", url, headers=headers) as response:
                    status = response.status_code
                    if status not in {200, 206}:
                        return Sample(phase, round_no, host, region, False, requests=request_count, http_status=status, error=f"HTTP {status}")
                    got_body = False
                    for chunk in response.iter_bytes(CHUNK_SIZE):
                        if not chunk:
                            continue
                        now = time.perf_counter()
                        got_body = True
                        if first_byte is None:
                            first_byte = now
                            warm_end = first_byte + warmup
                            deadline = warm_end + measure
                        assert warm_end is not None and deadline is not None
                        if now >= warm_end:
                            measured += len(chunk)
                            bucket = int((now - warm_end) / BUCKET_SECONDS)
                            buckets[bucket] = buckets.get(bucket, 0) + len(chunk)
                        if now >= deadline:
                            tail, _, ramp = bucket_stats(buckets)
                            if extend > 0 and not did_extend and ramp >= ramp_threshold and tail > 0:
                                deadline += extend
                                did_extend = True
                            else:
                                done = True
                                break
                    if not got_body:
                        raise RuntimeError("响应中没有媒体数据")
                if deadline is not None and time.perf_counter() >= deadline and not done:
                    tail, _, ramp = bucket_stats(buckets)
                    if extend > 0 and not did_extend and ramp >= ramp_threshold and tail > 0:
                        deadline += extend
                        did_extend = True
                    else:
                        done = True
            stopped = time.perf_counter()
    except Exception as exc:
        ttfb = ((first_byte - began) * 1000) if first_byte else 0.0
        return Sample(
            phase, round_no, host, region, False, ttfb_ms=ttfb,
            measured_bytes=measured, requests=request_count, http_status=status,
            error=f"{type(exc).__name__}: {str(exc)[:220]}",
        )
    assert first_byte is not None and warm_end is not None and deadline is not None
    elapsed = max(0.0, min(stopped, deadline) - warm_end)
    mbps = measured * 8 / elapsed / 1_000_000 if elapsed else 0.0
    tail, peak, ramp = bucket_stats(buckets)
    required = min(1.5, (measure + (extend if did_extend else 0)) * 0.5)
    ok = elapsed >= required and measured >= 256 * 1024
    error = "" if ok else f"采样不足: {elapsed:.2f}s, {measured / 1024:.0f} KiB"
    return Sample(
        phase, round_no, host, region, ok, mbps, tail, peak,
        (first_byte - began) * 1000, elapsed, measured, request_count,
        status, ramp, did_extend, error,
    )


def display(index: int, count: int, sample: Sample):
    if sample.ok:
        extension = "  ↗延长" if sample.extended else ""
        print(
            f"[{index:>3}/{count:<3}] {sample.mbps:>8.1f} Mbps  tail {sample.tail_mbps:>7.1f}  "
            f"TTFB {sample.ttfb_ms:>5.0f} ms  {sample.region:<4} {sample.host}{extension}",
            flush=True,
        )
    else:
        print(f"[{index:>3}/{count:<3}] {'FAIL':>8}       {sample.region:<4} {sample.host}  {sample.error}", flush=True)


def aggregate(host: str, region: str, samples: list[Sample]):
    good = [sample for sample in samples if sample.ok]
    rates = [sample.mbps for sample in good]
    return {
        "host": host,
        "region": region,
        "successes": len(good),
        "attempts": len(samples),
        "success_rate": len(good) / max(1, len(samples)),
        "median_mbps": statistics.median(rates) if rates else 0.0,
        "min_mbps": min(rates) if rates else 0.0,
        "max_mbps": max(rates) if rates else 0.0,
        "median_ttfb_ms": statistics.median(s.ttfb_ms for s in good) if good else 0.0,
        "samples_mbps": [round(rate, 3) for rate in rates],
    }


def main():
    parser = argparse.ArgumentParser(description="Bilibili CDN 持续带宽测速（慢启动友好版）")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--bvid", help="例如 BV1sVtw6JEN2")
    source.add_argument("--media-url", help="完整 bilivideo.com 媒体 URL")
    parser.add_argument("--region", action="append", help="限定 CCB 地区，可重复")
    parser.add_argument("--include", action="append", default=[], help="额外节点，可重复")
    parser.add_argument("--pin", action="append", default=[], help="强制进入终测，可重复")
    parser.add_argument("--no-default-pin", action="store_true")
    parser.add_argument("--top", type=int, default=5)
    parser.add_argument("--finalists", type=int, default=20)
    parser.add_argument("--coarse-retries", type=int, default=2, help="粗筛失败时最多尝试次数")
    parser.add_argument("--pre-warmup", type=float, default=2.0)
    parser.add_argument("--pre-measure", type=float, default=3.0)
    parser.add_argument("--pre-extend", type=float, default=3.0)
    parser.add_argument("--ramp-ratio", type=float, default=1.30)
    parser.add_argument("--warmup", type=float, default=2.5)
    parser.add_argument("--measure", type=float, default=8.0)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--connect-timeout", type=float, default=5.0)
    parser.add_argument("--read-timeout", type=float, default=8.0)
    parser.add_argument("--range-mib", type=int, default=64)
    parser.add_argument("--seed", type=int, default=20260829)
    parser.add_argument("--output-prefix", default="bili_cdn_sustained")
    args = parser.parse_args()
    if min(args.top, args.finalists, args.rounds, args.coarse_retries, args.range_mib) < 1:
        parser.error("top、finalists、rounds、coarse-retries、range-mib 必须 >= 1")
    if args.finalists < args.top:
        parser.error("finalists 必须 >= top")

    api_timeout = max(args.connect_timeout, args.read_timeout)
    donor = args.media_url or media_url_from_bvid(args.bvid, api_timeout)
    if not valid_media_url(donor):
        raise SystemExit("媒体 URL 必须属于 bilivideo.com，并保留完整 query 参数。")
    total = discover_total(donor, api_timeout)
    nodes = load_nodes(args.region, api_timeout)
    region_by_host = {host: region for host, region in nodes}
    for host in args.include:
        host = host.strip().lower()
        if host.endswith(".bilivideo.com") and host not in region_by_host:
            region_by_host[host] = "额外"
            nodes.append((host, "额外"))
    pins = [] if args.no_default_pin else [DEFAULT_PIN]
    pins.extend(host.strip().lower() for host in args.pin)
    for host in pins:
        if host.endswith(".bilivideo.com") and host not in region_by_host:
            region_by_host[host] = "保送"
            nodes.append((host, "保送"))

    print(f"待测节点: {len(nodes)}")
    print(f"媒体对象大小: {total / 1024 / 1024:.2f} MiB" if total else "媒体对象大小: 未知")
    print("全程串行；单个媒体对象较短时自动循环 Range 请求。")
    print(
        f"粗筛: {args.pre_warmup:g}s 预热 + {args.pre_measure:g}s 采样，"
        f"慢启动可延长 {args.pre_extend:g}s；失败最多 {args.coarse_retries} 次"
    )
    print(f"终测: {args.warmup:g}s 预热 + {args.measure:g}s 采样 × {args.rounds} 轮")
    if pins:
        print("保送终测: " + ", ".join(pins))
    print()

    rng = random.Random(args.seed)
    order = nodes[:]
    rng.shuffle(order)
    all_samples: list[Sample] = []
    coarse_best: dict[str, Sample] = {}
    print("=== 第一阶段：全量慢启动粗筛 ===")
    for index, (host, region) in enumerate(order, 1):
        attempts = []
        for attempt in range(1, args.coarse_retries + 1):
            sample = test_one(
                host, region, donor, total, phase="coarse", round_no=attempt,
                warmup=args.pre_warmup, measure=args.pre_measure, extend=args.pre_extend,
                ramp_threshold=args.ramp_ratio, connect_timeout=args.connect_timeout,
                read_timeout=args.read_timeout, range_mib=args.range_mib,
            )
            attempts.append(sample)
            all_samples.append(sample)
            if sample.ok:
                break
        best = max(attempts, key=lambda item: (item.ok, item.mbps))
        coarse_best[host] = best
        display(index, len(order), best)

    successful = [sample for sample in coarse_best.values() if sample.ok]
    if not successful:
        raise SystemExit("所有节点均失败；媒体 URL 可能已失效。")
    successful.sort(key=lambda s: (0.65 * s.mbps + 0.35 * s.tail_mbps, s.mbps), reverse=True)
    finalists = [sample.host for sample in successful[: args.finalists]]
    for host in pins:
        sample = coarse_best.get(host)
        if sample and sample.ok and host not in finalists:
            finalists.append(host)
    print(f"\n粗筛成功 {len(successful)}/{len(nodes)}，{len(finalists)} 个节点进入终测。\n")

    final_samples = {host: [] for host in finalists}
    print("=== 第二阶段：多轮持续带宽终测 ===")
    for round_no in range(1, args.rounds + 1):
        round_order = finalists[:]
        rng.shuffle(round_order)
        print(f"\n-- Round {round_no}/{args.rounds} --")
        for index, host in enumerate(round_order, 1):
            sample = test_one(
                host, region_by_host[host], donor, total, phase="final", round_no=round_no,
                warmup=args.warmup, measure=args.measure, extend=0.0,
                ramp_threshold=args.ramp_ratio, connect_timeout=args.connect_timeout,
                read_timeout=args.read_timeout, range_mib=args.range_mib,
            )
            final_samples[host].append(sample)
            all_samples.append(sample)
            display(index, len(round_order), sample)

    summary = [aggregate(host, region_by_host[host], final_samples[host]) for host in finalists]
    summary.sort(
        key=lambda item: (item["success_rate"], item["median_mbps"], item["min_mbps"], -item["median_ttfb_ms"]),
        reverse=True,
    )
    top = summary[: args.top]
    print(f"\n=== Top {len(top)} ===")
    for index, item in enumerate(top, 1):
        print(
            f"{index:>2}. {item['median_mbps']:>8.1f} Mbps  min {item['min_mbps']:>8.1f}  "
            f"max {item['max_mbps']:>8.1f}  {item['successes']}/{item['attempts']}  "
            f"{item['region']:<4} {item['host']}"
        )

    sample_path = Path(f"{args.output_prefix}_samples.csv")
    summary_path = Path(f"{args.output_prefix}_results.csv")
    json_path = Path(f"{args.output_prefix}_top{args.top}.json")
    with sample_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(asdict(all_samples[0]).keys()))
        writer.writeheader()
        writer.writerows(asdict(sample) for sample in all_samples)
    with summary_path.open("w", newline="", encoding="utf-8-sig") as handle:
        fields = [
            "host", "region", "coarse_mbps", "coarse_tail_mbps", "coarse_ttfb_ms", "coarse_error",
            "final_successes", "final_attempts", "final_success_rate", "final_median_mbps",
            "final_min_mbps", "final_max_mbps", "final_median_ttfb_ms",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        final_by_host = {item["host"]: item for item in summary}
        for host, region in nodes:
            coarse = coarse_best[host]
            final = final_by_host.get(host, {})
            writer.writerow({
                "host": host,
                "region": region,
                "coarse_mbps": round(coarse.mbps, 3) if coarse.ok else "",
                "coarse_tail_mbps": round(coarse.tail_mbps, 3) if coarse.ok else "",
                "coarse_ttfb_ms": round(coarse.ttfb_ms, 1) if coarse.ttfb_ms else "",
                "coarse_error": coarse.error,
                "final_successes": final.get("successes", ""),
                "final_attempts": final.get("attempts", ""),
                "final_success_rate": final.get("success_rate", ""),
                "final_median_mbps": round(final["median_mbps"], 3) if final else "",
                "final_min_mbps": round(final["min_mbps"], 3) if final else "",
                "final_max_mbps": round(final["max_mbps"], 3) if final else "",
                "final_median_ttfb_ms": round(final["median_ttfb_ms"], 1) if final else "",
            })
    json_path.write_text(
        json.dumps({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "top": top}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n逐次结果: {sample_path}")
    print(f"汇总结果: {summary_path}")
    print(f"Top 文件: {json_path}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n测速已手动中断", file=sys.stderr)
        sys.exit(130)

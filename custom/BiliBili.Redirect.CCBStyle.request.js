const cdn = $argument?.cdn;

const isSeparator =
	typeof cdn === "string" && /^─{2,}.*─{2,}$/.test(cdn.trim());

if (typeof cdn !== "string" || cdn.length === 0 || isSeparator) {
	console.log(
		isSeparator
			? "[BiliBili Redirect] 选择了地区分隔项，保留原请求"
			: "[BiliBili Redirect] 未收到 cdn 插件参数，保留原请求",
	);
	$done({});
} else {
	const url = new URL($request.url);
	url.protocol = "https:";
	url.hostname = cdn;
	url.port = "";

	const headers = { ...$request.headers };
	for (const name of Object.keys(headers)) {
		if (name.toLowerCase() === "host" || name.toLowerCase() === ":authority") {
			headers[name] = cdn;
		}
	}

	console.log(`[BiliBili Redirect] ${$request.url} -> ${url.toString()}`);
	$done({ url: url.toString(), headers });
}

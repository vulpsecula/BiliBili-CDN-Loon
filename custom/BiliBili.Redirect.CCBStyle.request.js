const cdn = $argument?.cdn;

if (typeof cdn !== "string" || cdn.length === 0) {
	console.log("[BiliBili Redirect] 未收到 cdn 插件参数，保留原请求");
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

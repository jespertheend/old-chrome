import {serveDir} from "jsr:@std/http@1.0.12/file-server"

Deno.serve(async (request) => {
	const url = new URL(request.url);
	if (url.pathname == "/platforms") {
		const response = await fetch("https://versionhistory.googleapis.com/v1/chrome/platforms/");
		const json = await response.json();
		return Response.json(json.platforms.map(p => p.platformType));
	}
	return await serveDir(request, {
		showDirListing: true,
		fsRoot: "static",
		quiet: true,
	});
});

import { serveDir } from "jsr:@std/http@1.0.12/file-server";
import { STATUS_CODE } from "jsr:@std/http@1.0.12/status";

export class HttpError extends Error {
	override name = "HttpError";

	#status;
	get status() {
		return this.#status;
	}

	constructor(status: number, message: string = "") {
		super(message);
		this.#status = status;
	}
}

type PlatformData = Map<string, string>;

let cachedPlatforms: Promise<PlatformData> | null = null;
function getPlatformData(): Promise<PlatformData> {
	if (cachedPlatforms) return cachedPlatforms;
	cachedPlatforms = (async () => {
		const response = await fetch("https://versionhistory.googleapis.com/v1/chrome/platforms/");
		const json = await response.json() as { platforms: { name: string; platformType: string }[] };
		const platformData: PlatformData = new Map();
		for (const { name, platformType } of json.platforms) {
			platformData.set(platformType, name);
		}
		return platformData;
	})();
	return cachedPlatforms;
}

function milestoneToVersion(platform: string, milestone: string) {
}

Deno.serve(async (request) => {
	try {
		const url = new URL(request.url);
		if (url.pathname == "/platforms") {
			const platformData = await getPlatformData();
			return Response.json(Array.from(platformData.keys()));
		} else if (url.pathname == "/download") {
			const platform = url.searchParams.get("platform");
			let version = url.searchParams.get("version");
			if (!platform || !version) {
				throw new HttpError(STATUS_CODE.BadRequest, "Missing parameters");
			}
			if (version.startsWith("M")) {
				version = milestoneToVersion(platform, version);
			}
			console.log({ platform, version });
		}
	} catch (e) {
		if (e instanceof HttpError) {
			return new Response(e.message || null, { status: e.status });
		}
		return new Response("Unknown error", { status: STATUS_CODE.InternalServerError });
	}
	return await serveDir(request, {
		showDirListing: true,
		fsRoot: "static",
		quiet: true,
	});
});

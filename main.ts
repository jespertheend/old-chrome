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

type PlatformConfig = {
	/**
	 * How the platform is listed in the drop down menu.
	 */
	displayName: string;
	/**
	 * The 'platformType' as seen on https://versionhistory.googleapis.com/v1/chrome/platforms/
	 * For instance, WIN_ARM64 is listed as "chrome/platforms/win_arm64", so the versionHistoryName would be "win_arm64"
	 */
	versionHistoryName: string;
	/**
	 * The platform directory name as seen on https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html
	 */
	listingDir: string;
	/**
	 * The name of the file to be downloaded.
	 * To find this, browse your platform on https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html
	 * and pick a random directory in the list of versions and look at which file corresponds to the main executable.
	 */
	downloadFileName: string;
};
/**
 * Platform types are a mess. versionhistory.googleapis.com uses a different set of
 * type specifiers as commondatastorage.googleapis.com and they don't easily map to each other.
 * I'm not really sure which are the most common platforms that people will want to download.
 * And I'm certainly not sure which platform specifier you'd want to use for each scenario.
 * If your platform is missing, please open a new issue.
 */
const platformConfigs: Record<string, PlatformConfig> = {
	windows: {
		displayName: "Windows",
		versionHistoryName: "win64",
		listingDir: "Win_x64",
		downloadFileName: "chrome-win.zip",
	},
	macIntel: {
		displayName: "Mac Intel",
		versionHistoryName: "mac",
		listingDir: "Mac",
		downloadFileName: "chrome-mac.zip",
	},
	macArm: {
		displayName: "Mac Arm",
		versionHistoryName: "mac_arm64",
		listingDir: "Mac_Arm",
		downloadFileName: "chrome-mac.zip",
	},
};

type ReleaseData = {
	name: string;
	version: string;
};

/**
 * Checks if the provided `milestoneOrVersion` is either a valid version or turns milestones (such as M120) into a valid version.
 */
async function findRelease(platformConfig: PlatformConfig, milestoneOrVersion: string) {
	const releasesUrl = `https://versionhistory.googleapis.com/v1/chrome/platforms/${platformConfig.versionHistoryName}/channels/stable/versions/all/releases`;
	const releasesResponse = await fetch(releasesUrl);
	const releaseListJson = await releasesResponse.json() as { releases: ReleaseData[] };
	const { releases } = releaseListJson;
	let pickedRelease;
	if (milestoneOrVersion.toUpperCase().startsWith("M")) {
		const milestoneNumber = milestoneOrVersion.match(/\d+/)?.[0];
		const milestoneVersions = releases.filter((release) => release.version.startsWith(milestoneNumber + "."));
		pickedRelease = milestoneVersions.sort((a, b) => {
			return a.version.localeCompare(b.version, undefined, { numeric: true });
		}).at(-1);
	} else {
		pickedRelease = releases.find((release) => release.version == milestoneOrVersion);
	}
	if (!pickedRelease) {
		throw new HttpError(STATUS_CODE.NotFound, "No versions for this milestone or version");
	}
	return pickedRelease;
}

/**
 * The base position of a commit doesn't necessarily have a build for a specific platform.
 * We will take the given basePos and find the first commit that does.
 */
async function findNextCommonPrefix(platformConfig: PlatformConfig, basePos: number) {
	const { listingDir } = platformConfig;
	const list = await fetch(`https://commondatastorage.googleapis.com/chromium-browser-snapshots/?delimiter=/&prefix=${listingDir}/&marker=${listingDir}/${basePos}/`);
	const listText = await list.text();
	// Find the first basePos in the returned xml
	const regExp = new RegExp(`<Prefix>${listingDir}\\/(\\d+)`);
	const match = listText.match(regExp);
	if (!match) {
		throw new HttpError(STATUS_CODE.NotFound, "No next base position was found for this version");
	}
	return Number(match[1]);
}

function getDownloadUrl(platformConfig: PlatformConfig, basePos: number) {
	const { listingDir, downloadFileName } = platformConfig;
	return `https://commondatastorage.googleapis.com/chromium-browser-snapshots/${listingDir}/${basePos}/${downloadFileName}`;
}

Deno.serve(async (request) => {
	try {
		const url = new URL(request.url);
		if (url.pathname == "/platforms") {
			return Response.json(platformConfigs);
		} else if (url.pathname == "/download") {
			const platform = url.searchParams.get("platform");
			const version = url.searchParams.get("version");
			if (!platform || !version) {
				throw new HttpError(STATUS_CODE.BadRequest, "Missing parameters");
			}

			const platformConfig = platformConfigs[platform];
			if (!platformConfig) {
				throw new HttpError(STATUS_CODE.BadRequest, "Invalid platform");
			}

			const release = await findRelease(platformConfig, version);

			const versionResponse = await fetch("https://chromiumdash.appspot.com/fetch_version?version=" + release.version);
			if (!versionResponse.ok) {
				throw new HttpError(STATUS_CODE.InternalServerError, "Failed to fetch version");
			}
			const versionJson = await versionResponse.json() as { chromium_main_branch_position: number | null };
			const basePos = versionJson.chromium_main_branch_position;
			if (!basePos) {
				throw new HttpError(STATUS_CODE.NotFound, "No base position was found for this version");
			}
			const newBasePos = await findNextCommonPrefix(platformConfig, basePos);

			return Response.redirect(getDownloadUrl(platformConfig, newBasePos));
		}
	} catch (e) {
		if (e instanceof HttpError) {
			return new Response(e.message || null, { status: e.status });
		}
		console.error(e);
		return new Response("Unknown error", { status: STATUS_CODE.InternalServerError });
	}
	return await serveDir(request, {
		showDirListing: true,
		fsRoot: "static",
		quiet: true,
	});
});

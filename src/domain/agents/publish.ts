import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import { TwitterApi } from "twitter-api-v2";
import { type AssetStore, BaseAgent, RunStage } from "../../io/core.js";
import { sendAlert } from "../../io/utils/discord.js";
import { ensureYouTubeVideoVisibility } from "../../io/utils/youtube_visibility.js";
import {
	asDancerPublicationState,
	buildYouTubeStatus,
	uploadAndVerifyCaption,
	verifyScheduledPublish,
	writeDancerUploadCheckpoint,
} from "../dancer_publication.js";
import {
	assertFactualIntegrityGate,
	assertNoLegacyPublishState,
	loadPublicationState,
	sha256File,
	transitionPublication,
	tryReuseCanonicalPublication,
} from "../publication_state.js";
import type { AgentState, AppConfig, PublishResults } from "../types.js";
import { validateCredentials } from "../validation.js";
import {
	assertYouTubeChannelMatchesProfile,
	getYouTubeProfile,
	hydrateOAuthCredentials,
} from "../youtube_profiles.js";

export class PublishAgent extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, RunStage.PUBLISH);
		this.validateInitialization();
	}

	private validateInitialization() {
		const enabledProviders = {
			youtube: !!this.config.steps.youtube?.enabled,
			twitter: !!this.config.steps.twitter?.enabled,
		};
		if (enabledProviders.youtube || enabledProviders.twitter) {
			validateCredentials(enabledProviders);
		}
		if (enabledProviders.youtube) {
			const profileName = process.env.YOUTUBE_CHANNEL_PROFILE?.trim();
			if (
				!profileName ||
				profileName === "default" ||
				profileName === "config/.env"
			) {
				throw new Error(
					"YouTube publish requires an explicit channel profile (set YOUTUBE_CHANNEL_PROFILE to byosan, yawa, or humanity)",
				);
			}
			getYouTubeProfile(profileName);
		}
	}

	async run(state: AgentState): Promise<PublishResults> {
		const publishVideoPath = this.resolvePublishVideoPath(state);
		if (publishVideoPath) {
			this.store.updateState({ publish_video_path: publishVideoPath });
		}
		this.assertNoFallbackPublish(state, publishVideoPath);
		this.logInput({
			video_path: state.video_path,
			publish_video_path: publishVideoPath,
			metadata: state.metadata,
		});
		const results: PublishResults = {};
		const ytStep = this.config.steps.youtube;
		if (ytStep?.enabled) {
			results.youtube = await this.uploadToYouTube(state, this.config, {
				publishVideoPath,
			});
			if (results.youtube?.status === "uploaded") {
				const videoId = results.youtube.video_id;
				const channelTitle = results.youtube.channel_title;
				const videoUrl = videoId
					? `https://www.youtube.com/watch?v=${videoId}`
					: "N/A";
				await sendAlert(
					`✅ **Successfully uploaded** video to ${channelTitle}!`,
					"publish",
					{
						title: state.metadata?.title || "N/A",
						videoId: videoId || "N/A",
						url: videoUrl,
						runId: state.run_id,
					},
				);
			}
		}
		const twStep = this.config.steps.twitter;
		if (twStep?.enabled) {
			results.twitter = await this.postToTwitter(state, this.config);
			if (results.twitter?.status === "posted") {
				await sendAlert(
					"🐦 **Successfully Posted** to Twitter (X)!",
					"publish",
					{
						tweetId: results.twitter.tweet_id || "N/A",
						title: state.metadata?.title || "N/A",
						runId: state.run_id,
					},
				);
			}
		}
		this.logOutput(results);
		if (Object.keys(results).length > 0) {
			const receiptPath = path.join(
				this.store.runDir,
				"publish",
				"receipt.json",
			);
			fs.ensureDirSync(path.dirname(receiptPath));
			const dancer = asDancerPublicationState(state);
			fs.writeJsonSync(
				receiptPath,
				{
					...results,
					...(dancer.source_artifact_sha256
						? { source_artifact_sha256: dancer.source_artifact_sha256 }
						: {}),
				},
				{ spaces: 2 },
			);
		}
		return results;
	}

	private assertNoFallbackPublish(
		state: AgentState,
		publishVideoPath?: string,
	): void {
		const metadata = state.metadata;
		const metadataText = [
			metadata?.title,
			metadata?.description,
			metadata?.thumbnail_title,
			...(metadata?.tags || []),
		]
			.filter(Boolean)
			.join("\n")
			.toLowerCase();
		if (
			/\bfallback\b/.test(metadataText) ||
			metadataText.includes("reused because") ||
			metadataText.includes("cached fallback")
		) {
			throw new Error(
				"YouTube publish blocked: fallback metadata is prohibited and must be deleted, not published.",
			);
		}

		const bucket = state.bucket || "";
		const isNotebookLmPulseBucket =
			bucket === "daily_pulse_nlm" || bucket === "pulse_nlm";
		const videoPath = publishVideoPath || state.video_path || "";
		if (
			isNotebookLmPulseBucket &&
			videoPath &&
			!path.resolve(videoPath).startsWith(path.resolve(this.store.runDir))
		) {
			throw new Error(
				"YouTube publish blocked: NotebookLM pulse publishing cannot reuse videos outside the current run directory.",
			);
		}
	}

	private async uploadToYouTube(
		state: AgentState,
		cfg: AppConfig,
		options: { publishVideoPath?: string } = {},
	): Promise<PublishResults["youtube"]> {
		const ytCfg = cfg.steps.youtube;
		if (!ytCfg) throw new Error("YouTube config missing");
		if (!ytCfg.default_visibility) {
			throw new Error(
				"YouTube publish failed: steps.youtube.default_visibility is missing in config/default.yaml",
			);
		}

		const profile = getYouTubeProfile(
			process.env.YOUTUBE_CHANNEL_PROFILE?.trim(),
		);
		const bucketAllowed =
			state.bucket === profile.bucket ||
			(profile.bucket === "daily_pulse" && state.bucket === "daily_pulse_nlm");
		if (!bucketAllowed) {
			throw new Error(
				`YouTube publish blocked: run bucket '${state.bucket}' does not match profile bucket '${profile.bucket}' for '${profile.profileName}'`,
			);
		}

		console.log(
			`[PUBLISH:CONFIG] upload_visibility=private requested_visibility=${ytCfg.default_visibility} source=config/default.yaml`,
		);
		console.log(
			`[PUBLISH:DESTINATION] bucket=${state.bucket} expected_bucket=${profile.bucket} profile=${profile.profileName}`,
		);

		const dancer = asDancerPublicationState(state);
		const { thumbnail_path: thumbnailPath } = state;
		const videoPath =
			options.publishVideoPath || this.resolvePublishVideoPath(state);
		if (!videoPath) throw new Error("Video path missing");
		if (!fs.existsSync(videoPath)) {
			throw new Error(`Video path does not exist: ${videoPath}`);
		}
		const artifactSha256 =
			dancer.source_artifact_sha256 || sha256File(videoPath);
		const requestedVisibility = dancer.publish_at
			? "scheduled"
			: ytCfg.default_visibility;
		console.log(`[PUBLISH:VIDEO] source=${videoPath} sha256=${artifactSha256}`);

		const auth = await this.createYouTubeClient();
		const youtube = google.youtube({ version: "v3", auth });
		await this.verifyYouTubeChannel(auth);

		const reusable = await tryReuseCanonicalPublication(
			youtube,
			this.store.runDir,
			artifactSha256,
			profile,
		);
		if (reusable?.state.phase === "VERIFIED") {
			console.log(
				`[PUBLISH:IDEMPOTENT_REUSE] video_id=${reusable.result.video_id}`,
			);
			return reusable.result;
		}
		const stored = loadPublicationState(this.store.runDir);
		if (
			stored &&
			!stored.video_id &&
			(stored.phase === "PRIVATE_UPLOAD_INTENT" ||
				stored.phase === "UNCERTAIN_REMOTE_COMMIT")
		) {
			throw new Error(
				`Canonical publish state is ${stored.phase} without a verified video id; refusing videos.insert until the remote commit is resolved`,
			);
		}
		if (!stored) assertNoLegacyPublishState(this.store.runDir);

		if (dancer.publish_at || ytCfg.default_visibility !== "private") {
			assertFactualIntegrityGate(this.store.runDir, state);
		}

		let videoId: string;
		let channelId: string;
		let channelTitle: string;
		let publishedAt: string;
		let observedPrivacy = reusable?.result.privacy_status ?? "unknown";

		if (reusable) {
			videoId = reusable.result.video_id || "";
			channelId = reusable.result.channel_id || "";
			channelTitle =
				reusable.result.channel_title || profile.expectedChannelTitle;
			publishedAt = reusable.result.published_at || "";
			if (!videoId || !channelId) {
				throw new Error(
					"Canonical reusable publication is missing remote identity",
				);
			}
			if (
				observedPrivacy !== "private" &&
				ytCfg.default_visibility !== "private" &&
				!dancer.publish_at &&
				observedPrivacy === ytCfg.default_visibility
			) {
				transitionPublication(this.store.runDir, {
					run_id: state.run_id,
					artifact_sha256: artifactSha256,
					requested_visibility: requestedVisibility,
					phase: "VERIFIED",
					video_id: videoId,
					channel_id: channelId,
					channel_title: channelTitle,
					observed_visibility: observedPrivacy,
				});
				return reusable.result;
			}
			if (observedPrivacy !== "private") {
				throw new Error(
					`Resumable publication expected private staging, got ${observedPrivacy}`,
				);
			}
		} else {
			transitionPublication(this.store.runDir, {
				run_id: state.run_id,
				artifact_sha256: artifactSha256,
				requested_visibility: requestedVisibility,
				phase: "PRIVATE_UPLOAD_INTENT",
			});
			const insertPrivateVideo = async () => {
				try {
					return await youtube.videos.insert({
						part: ["snippet", "status"],
						requestBody: this.createYouTubeSnippet(state, ytCfg),
						media: { body: fs.createReadStream(videoPath) },
					});
				} catch (error) {
					transitionPublication(this.store.runDir, {
						run_id: state.run_id,
						artifact_sha256: artifactSha256,
						requested_visibility: requestedVisibility,
						phase: "UNCERTAIN_REMOTE_COMMIT",
						failure_reason:
							error instanceof Error ? error.message : String(error),
					});
					throw error;
				}
			};
			const res = await insertPrivateVideo();
			const snippet = res.data.snippet;
			const status = res.data.status;
			videoId = res.data.id || "";
			channelId = snippet?.channelId || "";
			channelTitle = snippet?.channelTitle || "";
			publishedAt = snippet?.publishedAt ?? "";
			if (!videoId || !channelId || !channelTitle || !status?.privacyStatus) {
				transitionPublication(this.store.runDir, {
					run_id: state.run_id,
					artifact_sha256: artifactSha256,
					requested_visibility: requestedVisibility,
					phase: "UNCERTAIN_REMOTE_COMMIT",
					video_id: videoId || undefined,
					channel_id: channelId || undefined,
					channel_title: channelTitle || undefined,
					failure_reason:
						"YouTube upload response is missing remote identity/status",
				});
				throw new Error(
					"YouTube upload response is missing remote identity/status",
				);
			}
			if (status.privacyStatus !== "private") {
				transitionPublication(this.store.runDir, {
					run_id: state.run_id,
					artifact_sha256: artifactSha256,
					requested_visibility: requestedVisibility,
					phase: "UNCERTAIN_REMOTE_COMMIT",
					video_id: videoId,
					channel_id: channelId,
					channel_title: channelTitle,
					observed_visibility: status.privacyStatus,
					failure_reason: `insert returned ${status.privacyStatus} instead of private`,
				});
				throw new Error(
					`YouTube upload must stage private; insert returned privacyStatus=${status.privacyStatus}`,
				);
			}
			observedPrivacy = status.privacyStatus;
			transitionPublication(this.store.runDir, {
				run_id: state.run_id,
				artifact_sha256: artifactSha256,
				requested_visibility: requestedVisibility,
				phase: "PRIVATE_UPLOADED",
				video_id: videoId,
				channel_id: channelId,
				channel_title: channelTitle,
				observed_visibility: observedPrivacy,
			});
		}

		let privateAttestation: Awaited<
			ReturnType<typeof ensureYouTubeVideoVisibility>
		>;
		try {
			privateAttestation = await ensureYouTubeVideoVisibility(
				auth,
				videoId,
				"private",
			);
		} catch (error) {
			transitionPublication(this.store.runDir, {
				run_id: state.run_id,
				artifact_sha256: artifactSha256,
				requested_visibility: requestedVisibility,
				phase: "UNCERTAIN_REMOTE_COMMIT",
				video_id: videoId,
				channel_id: channelId,
				channel_title: channelTitle,
				failure_reason: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
		console.log(`[PUBLISH:PRIVATE_VERIFIED] video_id=${videoId}`);
		transitionPublication(this.store.runDir, {
			run_id: state.run_id,
			artifact_sha256: artifactSha256,
			requested_visibility: requestedVisibility,
			phase: "REMOTE_VERIFIED",
			video_id: videoId,
			channel_id: channelId,
			channel_title: channelTitle,
			observed_visibility: privateAttestation.current_privacy_status,
		});
		writeDancerUploadCheckpoint(this.store.runDir, state, {
			video_id: videoId,
			channel_id: channelId,
			channel_title: channelTitle,
			published_at: publishedAt,
			verified_private_at: privateAttestation.verified_at,
		});

		if (thumbnailPath) {
			try {
				await this.setYouTubeThumbnail(youtube, videoId, thumbnailPath);
			} catch (error) {
				if (dancer.source_manifest_path) throw error;
				console.warn(
					`YouTube thumbnail upload skipped for ${videoId}: ${(error as Error).message}`,
				);
			}
		}
		if (dancer.caption_path) {
			await uploadAndVerifyCaption(
				youtube,
				videoId,
				dancer.caption_path,
				this.store.runDir,
			);
		}

		let visibilityAttestation = privateAttestation;
		if (dancer.publish_at) {
			await verifyScheduledPublish(
				youtube,
				videoId,
				dancer.publish_at,
				this.store.runDir,
			);
		} else if (ytCfg.default_visibility !== "private") {
			visibilityAttestation = await ensureYouTubeVideoVisibility(
				auth,
				videoId,
				ytCfg.default_visibility,
			);
		}
		transitionPublication(this.store.runDir, {
			run_id: state.run_id,
			artifact_sha256: artifactSha256,
			requested_visibility: requestedVisibility,
			phase: "VISIBILITY_APPLIED",
			video_id: videoId,
			channel_id: channelId,
			channel_title: channelTitle,
			observed_visibility: visibilityAttestation.current_privacy_status,
		});
		fs.writeJsonSync(
			path.join(this.store.runDir, "publish", "visibility_attestation.json"),
			{
				...visibilityAttestation,
				staged_private: true,
				private_verified_at: privateAttestation.verified_at,
				...(dancer.publish_at ? { scheduled_for: dancer.publish_at } : {}),
			},
			{ spaces: 2 },
		);
		transitionPublication(this.store.runDir, {
			run_id: state.run_id,
			artifact_sha256: artifactSha256,
			requested_visibility: requestedVisibility,
			phase: "VERIFIED",
			video_id: videoId,
			channel_id: channelId,
			channel_title: channelTitle,
			observed_visibility: visibilityAttestation.current_privacy_status,
		});
		return {
			status: "uploaded",
			video_id: videoId,
			channel_id: channelId,
			channel_title: channelTitle,
			privacy_status: visibilityAttestation.current_privacy_status,
			published_at: publishedAt,
		};
	}

	private createYouTubeSnippet(
		state: AgentState,
		ytCfg: NonNullable<AppConfig["steps"]["youtube"]>,
	) {
		const metadata = state.metadata;
		return {
			snippet: {
				title: (metadata?.title || "").substring(0, ytCfg.max_title_length),
				description: (metadata?.description || "").substring(
					0,
					ytCfg.max_description_length,
				),
				tags: [...(ytCfg.default_tags || []), ...(metadata?.tags || [])],
				categoryId: (ytCfg.category_id || 24).toString(),
			},
			status: buildYouTubeStatus(state),
		};
	}

	private async verifyYouTubeChannel(
		auth: InstanceType<typeof google.auth.OAuth2>,
	) {
		const profileName = process.env.YOUTUBE_CHANNEL_PROFILE?.trim();
		const profile = getYouTubeProfile(profileName);
		await assertYouTubeChannelMatchesProfile(auth, profile);
	}

	private async createYouTubeClient() {
		const clientId = process.env.YOUTUBE_CLIENT_ID;
		const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
		const redirectUri =
			process.env.YOUTUBE_REDIRECT_URI ||
			"http://localhost:3000/oauth2callback";

		if (!clientId || !clientSecret) {
			throw new Error(
				"YouTube authentication failed: unable to initialize YouTube client",
			);
		}

		const client = new google.auth.OAuth2({
			clientId,
			clientSecret,
			redirectUri,
		});
		const profileName = process.env.YOUTUBE_CHANNEL_PROFILE?.trim();
		if (!profileName) {
			throw new Error(
				"YouTube client initialization requires YOUTUBE_CHANNEL_PROFILE",
			);
		}

		const profile = getYouTubeProfile(profileName);
		await hydrateOAuthCredentials(client, profile);
		return client;
	}

	private async setYouTubeThumbnail(
		youtube: ReturnType<typeof google.youtube>,
		videoId: string,
		thumbnailPath: string,
	) {
		const sizeBytes = fs.statSync(thumbnailPath).size;
		if (sizeBytes > 2 * 1024 * 1024) {
			throw new Error(`YouTube thumbnail exceeds 2 MB: ${sizeBytes} bytes`);
		}
		await youtube.thumbnails.set({
			videoId,
			media: {
				mimeType:
					path.extname(thumbnailPath).toLowerCase() === ".jpg" ||
					path.extname(thumbnailPath).toLowerCase() === ".jpeg"
						? "image/jpeg"
						: "image/png",
				body: fs.createReadStream(thumbnailPath),
			},
		});
		let thumbnailVariants: string[] = [];
		for (let attempt = 0; attempt < 6; attempt++) {
			const response = await youtube.videos.list({
				part: ["snippet"],
				id: [videoId],
			});
			thumbnailVariants = Object.keys(
				response.data.items?.[0]?.snippet?.thumbnails ?? {},
			);
			if (
				["default", "medium", "high"].every((key) =>
					thumbnailVariants.includes(key),
				)
			)
				break;
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
		if (
			!["default", "medium", "high"].every((key) =>
				thumbnailVariants.includes(key),
			)
		) {
			throw new Error(
				`Thumbnail update could not be verified for ${videoId}; variants=${thumbnailVariants.join(",")}`,
			);
		}
		fs.writeJsonSync(
			path.join(this.store.runDir, "publish", "thumbnail_attestation.json"),
			{
				video_id: videoId,
				source_path: thumbnailPath,
				mime_type:
					path.extname(thumbnailPath).toLowerCase() === ".jpg" ||
					path.extname(thumbnailPath).toLowerCase() === ".jpeg"
						? "image/jpeg"
						: "image/png",
				size_bytes: sizeBytes,
				api_update_status: "succeeded",
				thumbnail_variants: thumbnailVariants,
				verified_at: new Date().toISOString(),
			},
			{ spaces: 2 },
		);
	}

	private async postToTwitter(
		state: AgentState,
		cfg: AppConfig,
	): Promise<PublishResults["twitter"]> {
		const twCfg = cfg.steps.twitter;
		if (!twCfg) throw new Error("Twitter config missing");
		const client = this.createTwitterClient();
		const { metadata } = state;
		const videoPath = this.resolvePublishVideoPath(state);
		let mediaId: string | undefined;
		if (videoPath && fs.existsSync(videoPath))
			mediaId = await client.v1.uploadMedia(videoPath);
		const tweetText = this.createTweetText(metadata);
		const tweetPayload = { text: tweetText } as {
			text: string;
			media?: { media_ids: string[] };
		};
		if (mediaId) tweetPayload.media = { media_ids: [mediaId] };
		const res = await client.v2.tweet(tweetPayload as { text: string });
		return { status: "posted", tweet_id: res.data.id || "" };
	}

	private createTwitterClient() {
		const appKey = process.env.X_API_KEY || process.env.TWITTER_API_KEY;
		const appSecret =
			process.env.X_API_SECRET || process.env.TWITTER_API_SECRET;
		const accessToken =
			process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN;
		const accessSecret =
			process.env.X_ACCESS_SECRET || process.env.TWITTER_ACCESS_TOKEN_SECRET;
		if (!appKey || !appSecret || !accessToken || !accessSecret) {
			throw new Error(
				"Twitter authentication failed: unable to initialize Twitter client",
			);
		}
		return new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
	}

	private createTweetText(metadata?: AgentState["metadata"]) {
		const tags = (metadata?.tags || []).map((t) => `#${t}`).join(" ");
		return `${metadata?.title || ""}\n\n${tags}`.substring(0, 280);
	}

	public previewPublishVideoPath(state: AgentState): string {
		return this.resolvePublishVideoPath(state);
	}

	private resolvePublishVideoPath(state: AgentState): string {
		const candidates = [
			process.env.PUBLISH_VIDEO_PATH?.trim(),
			state.publish_video_path?.trim(),
			path.join(this.store.runDir, "publish_video.mp4"),
			path.join(this.store.runDir, "media", "video", "publish_video.mp4"),
			path.join(this.store.runDir, "video", "final_video.mp4"),
			path.join(this.store.runDir, "media", "video", "video.mp4"),
			state.video_path?.trim(),
		].filter(Boolean) as string[];

		for (const candidate of candidates) {
			const resolved = path.isAbsolute(candidate)
				? candidate
				: path.join(this.store.runDir, candidate);
			if (fs.existsSync(resolved)) {
				if (resolved !== state.video_path) state.publish_video_path = resolved;
				return resolved;
			}
		}
		return state.video_path || "";
	}
}

import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import sharp from "sharp";
import { TwitterApi } from "twitter-api-v2";
import { type AssetStore, BaseAgent, RunStage } from "../../io/core.js";
import { sendAlert } from "../../io/utils/discord.js";
import { ensureYouTubeVideoVisibility } from "../../io/utils/youtube_visibility.js";
import {
	type PublishJob,
	type VerifiedReceipt,
	convertAssToWebVtt,
	parsePublishJobFile,
	publishJobFingerprint,
	readUploadIntent,
	readVerifiedReceipt,
	writeUploadIntent,
	writeVerifiedReceipt,
} from "../publish_contract.js";
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
		const publishJob = this.loadPublishJob();
		const stateRunId = state.run_id.split("/").pop();
		if (
			publishJob &&
			publishJob.run_id !== state.run_id &&
			publishJob.run_id !== stateRunId
		) {
			throw new Error(
				`Publish job run_id mismatch: job='${publishJob.run_id}' state='${state.run_id}'`,
			);
		}
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
				publishJob,
			});
			if (results.youtube?.status === "uploaded") {
				const videoId = results.youtube.video_id;
				const channelTitle = results.youtube.channel_title;
				const videoUrl = videoId
					? `https://www.youtube.com/watch?v=${videoId}`
					: "N/A";
				await sendAlert(
					`✅ **Successfully Published** video to ${channelTitle}!`,
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
		if (Object.keys(results).length > 0 && !publishJob) {
			const receiptPath = path.join(
				this.store.runDir,
				"publish",
				"receipt.json",
			);
			fs.ensureDirSync(path.dirname(receiptPath));
			fs.writeJsonSync(receiptPath, results, { spaces: 2 });
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
		options: { publishVideoPath?: string; publishJob?: PublishJob } = {},
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
			`[PUBLISH:CONFIG] visibility=${ytCfg.default_visibility} source=config/default.yaml`,
		);
		console.log(
			`[PUBLISH:DESTINATION] bucket=${state.bucket} expected_bucket=${profile.bucket} profile=${profile.profileName}`,
		);

		const auth = await this.createYouTubeClient();
		const youtube = google.youtube({
			version: "v3",
			auth,
		});
		await this.verifyYouTubeChannel(auth);
		const videoPath =
			options.publishVideoPath || this.resolvePublishVideoPath(state);
		if (options.publishJob) {
			return this.uploadWithPublishContract(
				state,
				options.publishJob,
				videoPath,
				youtube,
			);
		}
		const { thumbnail_path: thumbnailPath } = state;
		if (!videoPath) throw new Error("Video path missing");
		console.log(`[PUBLISH:VIDEO] source=${videoPath}`);
		const res = await youtube.videos.insert({
			part: ["snippet", "status"],
			requestBody: this.createYouTubeSnippet(state, ytCfg),
			media: { body: fs.createReadStream(videoPath) },
		});
		const videoId = res.data.id;
		const snippet = res.data.snippet;
		const status = res.data.status;
		if (!videoId) {
			throw new Error("YouTube upload response is missing video id");
		}
		if (!snippet?.channelId) {
			throw new Error("YouTube upload response is missing channelId");
		}
		if (!snippet.channelTitle) {
			throw new Error("YouTube upload response is missing channelTitle");
		}
		if (!status?.privacyStatus) {
			throw new Error("YouTube upload response is missing privacyStatus");
		}

		if (thumbnailPath) {
			try {
				await this.setYouTubeThumbnail(youtube, videoId, thumbnailPath);
			} catch (error) {
				console.warn(
					`YouTube thumbnail upload skipped for ${videoId}: ${(error as Error).message}`,
				);
			}
		}
		const visibilityAttestation = await ensureYouTubeVideoVisibility(
			auth,
			videoId,
			ytCfg.default_visibility,
		);
		fs.writeJsonSync(
			path.join(this.store.runDir, "publish", "visibility_attestation.json"),
			visibilityAttestation,
			{ spaces: 2 },
		);
		return {
			status: "uploaded",
			video_id: videoId,
			channel_id: snippet.channelId,
			channel_title: snippet.channelTitle,
			privacy_status: visibilityAttestation.current_privacy_status,
			published_at: snippet.publishedAt ?? "",
		};
	}
	private loadPublishJob(): PublishJob | undefined {
		const configuredPath = process.env.YOUTUBE_PUBLISH_JOB_PATH?.trim();
		if (!configuredPath) return undefined;
		return parsePublishJobFile(configuredPath);
	}
	private async uploadWithPublishContract(
		state: AgentState,
		job: PublishJob,
		publishVideoPath: string | undefined,
		youtube: ReturnType<typeof google.youtube>,
	): Promise<PublishResults["youtube"]> {
		const profile = getYouTubeProfile(
			process.env.YOUTUBE_CHANNEL_PROFILE?.trim(),
		);
		if (job.profile !== profile.profileName) {
			throw new Error(
				`Publish job profile mismatch: job='${job.profile}' env='${profile.profileName}'`,
			);
		}
		if (job.bucket !== state.bucket || job.bucket !== profile.bucket) {
			throw new Error(
				`Publish job bucket mismatch: job='${job.bucket}' state='${state.bucket}' profile='${profile.bucket}'`,
			);
		}
		if (!publishVideoPath || !fs.existsSync(publishVideoPath)) {
			throw new Error("Publish contract requires an existing rendered video");
		}
		if (
			job.target_visibility !== "private" &&
			(!job.allow_publicize || process.env.YOUTUBE_ALLOW_PUBLICIZE !== "true")
		) {
			throw new Error(
				`Publish blocked: target '${job.target_visibility}' requires explicit job-scoped publicize approval`,
			);
		}

		const fingerprint = publishJobFingerprint(job);
		const existingReceipt = readVerifiedReceipt(this.store.runDir);
		if (existingReceipt) {
			if (existingReceipt.job_fingerprint !== fingerprint) {
				throw new Error(
					`Publish receipt fingerprint mismatch: receipt='${existingReceipt.job_fingerprint}' job='${fingerprint}'`,
				);
			}
			const audit = await this.auditRemoteVideo(
				youtube,
				existingReceipt.youtube.video_id,
				job,
			);
			return this.resultFromVerifiedReceipt(existingReceipt, audit);
		}

		const existingIntent = readUploadIntent(this.store.runDir);
		if (existingIntent) {
			throw new Error(
				`UNCERTAIN_REMOTE_COMMIT: ${existingIntent.job_fingerprint} has upload intent but no verified receipt; videos.insert is forbidden`,
			);
		}
		const ytCfg = this.config.steps.youtube;
		if (!ytCfg) throw new Error("YouTube config missing");

		const thumbnailPath = await this.prepareThumbnailInput(state, job);
		const captionsPath = await this.resolveCaptionsPath(job);
		if (job.captions.required && !captionsPath) {
			throw new Error("Publish contract requires a time-coded captions file");
		}

		writeUploadIntent(this.store.runDir, {
			schema_version: "yt3.upload-intent.v1",
			job_fingerprint: fingerprint,
			job_id: job.job_id,
			profile: job.profile,
			run_id: state.run_id,
			video_path: publishVideoPath,
			created_at: new Date().toISOString(),
			status: "insert_started",
		});

		const inserted = await youtube.videos.insert({
			part: ["snippet", "status"],
			requestBody: {
				...this.createYouTubeSnippet(state, ytCfg),
				status: {
					privacyStatus: "private",
					selfDeclaredMadeForKids: false,
				},
			},
			media: { body: fs.createReadStream(publishVideoPath) },
		});
		const videoId = inserted.data.id;
		if (!videoId)
			throw new Error("YouTube upload response is missing video id");

		let audit = await this.auditRemoteVideo(youtube, videoId, job, "private");
		let customThumbnailVerified = false;
		if (job.thumbnail_required) {
			if (!thumbnailPath) {
				throw new Error("Publish contract requires a thumbnail");
			}
			await this.setYouTubeThumbnail(youtube, videoId, thumbnailPath);
			customThumbnailVerified = await this.verifyCustomThumbnail(
				youtube,
				videoId,
			);
			if (!customThumbnailVerified) {
				throw new Error(
					`Thumbnail verification failed for ${videoId}: contentDetails.hasCustomThumbnail was not true`,
				);
			}
		}

		let captionsVerified = false;
		if (job.captions.required && captionsPath) {
			await this.uploadCaptions(youtube, videoId, job, captionsPath);
			captionsVerified = await this.verifyCaptions(youtube, videoId);
			if (!captionsVerified) {
				throw new Error(`Caption serving verification failed for ${videoId}`);
			}
		}

		// The first audit is always against the private staging state.
		audit = await this.auditRemoteVideo(youtube, videoId, job, "private");
		if (job.target_visibility !== "private") {
			await this.applyTargetVisibility(youtube, videoId, job);
			audit = await this.auditRemoteVideo(youtube, videoId, job);
		}

		const result = {
			status: "uploaded" as const,
			video_id: videoId,
			channel_id: audit.channel_id,
			channel_title: audit.channel_title,
			privacy_status: audit.privacy_status,
			published_at: audit.published_at,
			receipt_status: "VERIFIED" as const,
			job_fingerprint: fingerprint,
			target_visibility: job.target_visibility,
			staging_privacy_status: "private",
			processing_status: "succeeded",
			custom_thumbnail_verified: customThumbnailVerified,
			captions_verified: captionsVerified,
			publish_at: job.publish_at,
			remote_audit: audit.remote_audit,
		};
		writeVerifiedReceipt(this.store.runDir, {
			schema_version: "yt3.verified-receipt.v1",
			receipt_status: "VERIFIED",
			job_fingerprint: fingerprint,
			job_id: job.job_id,
			verified_at: new Date().toISOString(),
			youtube: {
				status: "uploaded",
				video_id: videoId,
				channel_id: audit.channel_id,
				channel_title: audit.channel_title,
				staging_privacy_status: "private",
				target_visibility: job.target_visibility,
				privacy_status:
					audit.privacy_status as VerifiedReceipt["youtube"]["privacy_status"],
				processing_status: "succeeded",
				custom_thumbnail_verified: customThumbnailVerified,
				captions_verified: captionsVerified,
				published_at: audit.published_at,
				publish_at: job.publish_at,
			},
			remote_audit: audit.remote_audit,
		});
		return result;
	}
	private async prepareThumbnailInput(
		state: AgentState,
		job: PublishJob,
	): Promise<string | undefined> {
		if (!job.thumbnail_required) return undefined;
		const candidates = [
			state.thumbnail_path,
			path.join(this.store.runDir, "thumbnail_youtube.jpg"),
			path.join(this.store.runDir, "thumbnail.jpg"),
		].filter(Boolean) as string[];
		for (const candidate of candidates) {
			if (!fs.existsSync(candidate)) continue;
			const extension = path.extname(candidate).toLowerCase();
			if (![".png", ".jpg", ".jpeg"].includes(extension)) continue;
			if (fs.statSync(candidate).size <= 2 * 1024 * 1024) return candidate;
		}
		const source = candidates.find((candidate) => fs.existsSync(candidate));
		if (!source) {
			throw new Error("Publish contract requires an existing thumbnail");
		}
		const converted = path.join(this.store.runDir, "publish", "thumbnail.jpg");
		for (const quality of [85, 75, 65]) {
			await sharp(source).jpeg({ quality, mozjpeg: true }).toFile(converted);
			if (fs.statSync(converted).size <= 2 * 1024 * 1024) return converted;
		}
		throw new Error("Custom thumbnails must not exceed 2 MiB");
	}
	private async resolveCaptionsPath(
		job: PublishJob,
	): Promise<string | undefined> {
		if (!job.captions.path) return undefined;
		const resolved = path.isAbsolute(job.captions.path)
			? job.captions.path
			: path.resolve(process.cwd(), job.captions.path);
		if (fs.existsSync(resolved)) return resolved;
		const assCandidates = [
			path.join(this.store.runDir, this.store.cfg.workflow.filenames.subtitles),
			path.join(path.dirname(resolved), "subtitles.ass"),
		];
		const assPath = assCandidates.find((candidate) => fs.existsSync(candidate));
		if (assPath && path.extname(resolved).toLowerCase() === ".vtt") {
			convertAssToWebVtt(assPath, resolved);
			return resolved;
		}
		return undefined;
	}
	private async auditRemoteVideo(
		youtube: ReturnType<typeof google.youtube>,
		videoId: string,
		job: PublishJob,
		expectedPrivacy?: string,
	) {
		const attempts = Number(
			process.env.YOUTUBE_PROCESSING_AUDIT_ATTEMPTS || 12,
		);
		const waitMs = Number(process.env.YOUTUBE_PROCESSING_AUDIT_WAIT_MS || 5000);
		let lastStatus = "unknown";
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			const response = await youtube.videos.list({
				part: ["status", "processingDetails", "contentDetails", "snippet"],
				id: [videoId],
			});
			const item = response.data.items?.[0];
			if (!item) throw new Error(`Remote video not found: ${videoId}`);
			if (
				item.snippet?.channelId !==
				getYouTubeProfile(job.profile).expectedChannelId
			) {
				throw new Error(`Remote video channel mismatch for ${videoId}`);
			}
			lastStatus = item.processingDetails?.processingStatus || "unknown";
			if (lastStatus === "failed") {
				throw new Error(`YouTube processing failed for ${videoId}`);
			}
			const privacy = item.status?.privacyStatus || "unknown";
			const publishAt = item.status?.publishAt || undefined;
			const privacyMatches = expectedPrivacy
				? privacy === expectedPrivacy
				: job.target_visibility === "scheduled"
					? privacy === "private" && publishAt === job.publish_at
					: privacy === job.target_visibility;
			if (lastStatus === "succeeded" && privacyMatches) {
				return {
					channel_id: item.snippet?.channelId || "",
					channel_title: item.snippet?.channelTitle || "",
					privacy_status: privacy,
					published_at: item.snippet?.publishedAt || undefined,
					remote_audit: {
						video_id: videoId,
						processing_status: lastStatus,
						privacy_status: privacy,
						publish_at: publishAt,
						channel_id: item.snippet?.channelId,
						channel_title: item.snippet?.channelTitle,
						content_details: item.contentDetails,
						verified_at: new Date().toISOString(),
					},
				};
			}
			if (attempt < attempts)
				await new Promise((resolve) => setTimeout(resolve, waitMs));
		}
		throw new Error(
			`PENDING: YouTube processing verification did not complete for ${videoId}; status=${lastStatus}`,
		);
	}
	private async verifyCustomThumbnail(
		youtube: ReturnType<typeof google.youtube>,
		videoId: string,
	): Promise<boolean> {
		const attempts = Number(process.env.YOUTUBE_MEDIA_AUDIT_ATTEMPTS ?? 6);
		const waitMs = Number(process.env.YOUTUBE_MEDIA_AUDIT_WAIT_MS ?? 3000);
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			const response = await youtube.videos.list({
				part: ["contentDetails"],
				id: [videoId],
			});
			if (response.data.items?.[0]?.contentDetails?.hasCustomThumbnail === true)
				return true;
			if (attempt < attempts)
				await new Promise((resolve) => setTimeout(resolve, waitMs));
		}
		return false;
	}
	private async uploadCaptions(
		youtube: ReturnType<typeof google.youtube>,
		videoId: string,
		job: PublishJob,
		captionsPath: string,
	): Promise<void> {
		await youtube.captions.insert({
			part: ["snippet"],
			requestBody: {
				snippet: {
					videoId,
					language: job.captions.language,
					name: job.captions.name,
					isDraft: false,
				},
			},
			media: { body: fs.createReadStream(captionsPath) },
		});
	}
	private async verifyCaptions(
		youtube: ReturnType<typeof google.youtube>,
		videoId: string,
	): Promise<boolean> {
		const attempts = Number(process.env.YOUTUBE_MEDIA_AUDIT_ATTEMPTS ?? 6);
		const waitMs = Number(process.env.YOUTUBE_MEDIA_AUDIT_WAIT_MS ?? 3000);
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			const response = await youtube.captions.list({
				part: ["snippet"],
				videoId,
			});
			if (
				(response.data.items || []).some(
					(item) => item.snippet?.status === "serving",
				)
			)
				return true;
			if (attempt < attempts)
				await new Promise((resolve) => setTimeout(resolve, waitMs));
		}
		return false;
	}
	private async applyTargetVisibility(
		youtube: ReturnType<typeof google.youtube>,
		videoId: string,
		job: PublishJob,
	): Promise<void> {
		if (job.target_visibility === "scheduled") {
			await youtube.videos.update({
				part: ["status"],
				requestBody: {
					id: videoId,
					status: { privacyStatus: "private", publishAt: job.publish_at },
				},
			});
			return;
		}
		await youtube.videos.update({
			part: ["status"],
			requestBody: {
				id: videoId,
				status: { privacyStatus: job.target_visibility },
			},
		});
	}
	private resultFromVerifiedReceipt(
		receipt: VerifiedReceipt,
		audit: Awaited<ReturnType<PublishAgent["auditRemoteVideo"]>>,
	): PublishResults["youtube"] {
		return {
			status: "uploaded",
			video_id: receipt.youtube.video_id,
			channel_id: audit.channel_id,
			channel_title: audit.channel_title,
			privacy_status: audit.privacy_status,
			published_at: audit.published_at,
			receipt_status: "VERIFIED",
			job_fingerprint: receipt.job_fingerprint,
			target_visibility: receipt.youtube.target_visibility,
			staging_privacy_status: "private",
			processing_status: "succeeded",
			custom_thumbnail_verified: receipt.youtube.custom_thumbnail_verified,
			captions_verified: receipt.youtube.captions_verified,
			publish_at: receipt.youtube.publish_at,
			remote_audit: audit.remote_audit,
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
			status: {
				privacyStatus: ytCfg.default_visibility,
				selfDeclaredMadeForKids: false,
			},
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

		if (profileName === "humanity") {
			const profile = getYouTubeProfile(profileName);
			await hydrateOAuthCredentials(client, profile);
		} else {
			const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
			if (refreshToken) {
				client.setCredentials({ refresh_token: refreshToken });
			}
		}

		return client;
	}
	private async setYouTubeThumbnail(
		youtube: ReturnType<typeof google.youtube>,
		videoId: string,
		thumbnailPath: string,
	) {
		await youtube.thumbnails.set({
			videoId: videoId,
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
			) {
				break;
			}
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
				size_bytes: fs.statSync(thumbnailPath).size,
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

		return new TwitterApi({
			appKey,
			appSecret,
			accessToken,
			accessSecret,
		});
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
				if (resolved !== state.video_path) {
					state.publish_video_path = resolved;
				}
				return resolved;
			}
		}

		return state.video_path || "";
	}
}

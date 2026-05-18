#!/usr/bin/env bash
set -euo pipefail

today="$(date +%F)"
channels=("daily_pulse" "humanity_observatory")

for channel in "${channels[@]}"; do
	run_dir="runs/${channel}/${today}"
	research_done="no"
	video_done="no"
	publish_done="no"

	if [ -d "${run_dir}" ]; then
		case "${channel}" in
			daily_pulse)
				if [ -f "${run_dir}/research/output.yaml" ] || [ -f "${run_dir}/web_search/input.yaml" ]; then
					research_done="yes"
				fi
				if [ -f "${run_dir}/media/video/video.mp4" ] || [ -f "${run_dir}/video/final_video.mp4" ]; then
					video_done="yes"
				fi
				if [ -f "${run_dir}/publish/output.yaml" ] || [ -f "${run_dir}/publish/receipt.json" ]; then
					publish_done="yes"
				fi
				;;
			humanity_observatory)
				if [ -f "${run_dir}/research.json" ] || [ -f "${run_dir}/research/output.yaml" ]; then
					research_done="yes"
				fi
				if [ -f "${run_dir}/media/video/video.mp4" ] || [ -f "${run_dir}/video/final_video.mp4" ]; then
					video_done="yes"
				fi
				if [ -f "${run_dir}/publish/output.yaml" ]; then
					publish_done="yes"
				fi
				;;
		esac
	fi

	printf "\n[%s] %s\n" "${channel}" "${run_dir}"
	printf "  research/web_search: %s\n" "${research_done}"
	printf "  video_production: %s\n" "${video_done}"
	printf "  publish: %s\n" "${publish_done}"

	if [ "${research_done}" != "yes" ] || [ "${video_done}" != "yes" ] || [ "${publish_done}" != "yes" ]; then
		printf "  brainstorm:\n"
		[ "${research_done}" != "yes" ] && printf "    - Gather today's raw facts and choose a fresh angle.\n"
		[ "${video_done}" != "yes" ] && printf "    - Check the latest script and media artifacts, then identify the smallest missing production step.\n"
		[ "${publish_done}" != "yes" ] && printf "    - Verify the publish receipt and the channel state before deciding the run is done.\n"
		printf "    - If the topic feels stale, pivot to a more concrete or more local angle instead of forcing the old one.\n"
	fi
done

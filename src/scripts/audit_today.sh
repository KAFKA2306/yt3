#!/usr/bin/env bash
set -euo pipefail

today="$(date +%F)"
channels=("byosan_money" "humanity_observatory")

find_run_dir() {
	local channel="$1"
	local exact="runs/${channel}/${today}"
	if [ -d "${exact}" ]; then
		printf "%s\n" "${exact}"
		return
	fi
	find "runs/${channel}" -maxdepth 1 -type d -name "${today}-*" -print 2>/dev/null | sort -r | head -n 1
}

for channel in "${channels[@]}"; do
	run_dir="$(find_run_dir "${channel}")"
	if [ -z "${run_dir}" ]; then
		run_dir="runs/${channel}/${today}"
	fi
	research_done="no"
	video_done="no"
	publish_done="no"

	if [ -d "${run_dir}" ]; then
		case "${channel}" in
			byosan_money)
				if [ -f "${run_dir}/research.json" ] || [ -f "${run_dir}/content/output.yaml" ] || [ -f "${run_dir}/research/output.yaml" ] || [ -f "${run_dir}/web_search/input.yaml" ]; then
					research_done="yes"
				fi
				if [ -f "${run_dir}/media/video/video.mp4" ] || [ -f "${run_dir}/video/final_video.mp4" ]; then
					video_done="yes"
				fi
				if [ -f "${run_dir}/publish/receipt.json" ]; then
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
				if [ -f "${run_dir}/publish/receipt.json" ]; then
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

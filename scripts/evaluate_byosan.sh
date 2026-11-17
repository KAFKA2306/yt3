#!/bin/sh
set -eu
umask 077

if [ "$#" -ne 2 ]; then
	printf '%s\n' 'Usage: sh scripts/evaluate_byosan.sh prepare|generate|judge|report OUTPUT_DIR' >&2
	exit 1
fi

action=$1
output=$2
script=src/scripts/evaluate_byosan.ts
case "$action" in
	prepare)
		exec bun "$script" prepare "$output" "${EVAL_TRIALS:-1}" "${EVAL_EFFORT:-low}"
		;;
	report)
		exec bun "$script" report "$output"
		;;
	generate|judge)
		test -d "$output/packets"
		;;
	*)
		exit 1
		;;
esac

trials=$(bun -e 'const x = await Bun.file(process.argv[1]).json(); console.log(x.trials)' "$output/matrix.json")
astra_effort=$(bun -e 'const x = await Bun.file(process.argv[1]).json(); console.log(x.astra_effort)' "$output/matrix.json")

for packet in "$output"/packets/*.json; do
	case_name=$(basename "$packet" .json)
	for model in gpt-6-astra gpt-6.1-terra; do
		for trial in $(seq 1 "$trials"); do
			run="$output/runs/$case_name/$model/$trial"
			mkdir -p "$run"
			if [ "$action" = generate ]; then
				effort=$astra_effort
				if [ "$model" = gpt-6.1-terra ]; then effort=medium; fi
				if (set -C; : > "$run/generate.json") 2>/dev/null; then
					bun "$script" generate "$packet" "$model" "$effort" "$run/generate" > "$run/generate.json" || {
						status=$?
						if [ "$status" -ne 2 ]; then exit "$status"; fi
					}
				fi
			elif [ -s "$run/generate.json" ] &&
				[ -f "$run/generate/response.json" ] &&
				bun -e 'const x = await Bun.file(process.argv[1]).json(); process.exit(x.status === "pass" ? 0 : 1)' "$run/generate.json" &&
				(set -C; : > "$run/judge.json") 2>/dev/null; then
				bun "$script" judge "$packet" "$run/generate/response.json" "$output/packets/$case_name.key.txt" "${EVAL_JUDGE_MODEL:-gpt-6.1-sol}" "${EVAL_JUDGE_EFFORT:-low}" "$run/judge" > "$run/judge.json" || {
					status=$?
					if [ "$status" -ne 2 ]; then exit "$status"; fi
				}
			fi
		done
	done
done

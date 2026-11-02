#!/usr/bin/env bash
# CI: run the mobile suites on the emulator booted by reactivecircus/android-emulator-runner.
# Failing checks are findings — they go into the results page, so they don't fail the job.
# The job fails only when no results were recorded at all (a setup problem: emulator, Appium, APK).
#
#   MOBILE_SUITES="auth navigation journeys" bash scripts/ci-mobile-run.sh
set -uo pipefail

adb wait-for-device
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

args=()
for s in ${MOBILE_SUITES:-auth navigation journeys}; do args+=(--suite "$s"); done

npx wdio run mobile/config/wdio.android.conf.ts "${args[@]}" --specFileRetries 0
status=$?

if ! ls reports/mobile-results/*.jsonl >/dev/null 2>&1; then
  echo "::error::No mobile results were recorded (WebdriverIO exit $status) — check the emulator, Appium and APK steps."
  exit 1
fi
echo "WebdriverIO exit $status — results recorded in reports/mobile-results"

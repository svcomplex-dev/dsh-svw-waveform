#!/bin/sh
set -eu

zero=0000000000000000000000000000000000000000
good=hook-policy-good
wrong=hook-policy-wrong
light=hook-policy-light
cleanup() { git tag -d "$good" "$wrong" "$light" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
cleanup
GIT_COMMITTER_NAME=svcomplex-dev GIT_COMMITTER_EMAIL=code@svcomplex.ai git tag -a "$good" -m good HEAD
good_sha=$(git rev-parse "refs/tags/$good")
printf "refs/tags/%s %s refs/tags/%s %s\n" "$good" "$good_sha" "$good" "$zero" | .githooks/pre-push origin
GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=wrong@example.invalid git tag -a "$wrong" -m wrong HEAD
wrong_sha=$(git rev-parse "refs/tags/$wrong")
if printf "refs/tags/%s %s refs/tags/%s %s\n" "$wrong" "$wrong_sha" "$wrong" "$zero" | \
  .githooks/pre-push origin >/dev/null 2>&1; then
  echo "pre-push accepted a forbidden tagger email" >&2
  exit 1
fi
git tag "$light" HEAD
light_sha=$(git rev-parse "refs/tags/$light")
if printf "refs/tags/%s %s refs/tags/%s %s\n" "$light" "$light_sha" "$light" "$zero" | \
  .githooks/pre-push origin >/dev/null 2>&1; then
  echo "pre-push accepted a lightweight release tag" >&2
  exit 1
fi
echo "git hook tag policy tests passed"

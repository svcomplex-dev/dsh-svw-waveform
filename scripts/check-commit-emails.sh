#!/bin/sh
set -eu

required_email=code@svcomplex.ai
[ "$#" -gt 0 ] || { echo "usage: scripts/check-commit-emails.sh COMMIT..." >&2; exit 64; }
for commit in "$@"; do
  git cat-file -e "$commit^{commit}"
  author_email=$(git show -s --format=%ae "$commit")
  committer_email=$(git show -s --format=%ce "$commit")
  [ "$author_email" = "$required_email" ] || {
    echo "error: commit $commit author email is $author_email; expected $required_email" >&2
    exit 1
  }
  [ "$committer_email" = "$required_email" ] || {
    echo "error: commit $commit committer email is $committer_email; expected $required_email" >&2
    exit 1
  }
done
printf 'verified commit email policy for %s commit(s)\n' "$#"

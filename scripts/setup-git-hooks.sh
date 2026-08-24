#!/bin/sh
set -eu

git config --local user.name svcomplex-dev
git config --local user.email code@svcomplex.ai
git config --local core.hooksPath .githooks
echo "configured repository hooks and code@svcomplex.ai identity"

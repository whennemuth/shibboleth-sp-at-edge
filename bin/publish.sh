#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")
tarball="${name}-${version}.tgz"
s3_dir="s3://simple-npm-package-bucket/${name}"

require_clean_git() {
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "Uncommitted changes - commit before publishing ${version}." >&2
    exit 1
  fi
}

publish_s3() {
  if aws s3 ls "${s3_dir}/${tarball}" > /dev/null 2>&1; then
    echo "${tarball} already exists in ${s3_dir} - bump the version first." >&2
    exit 1
  fi
  npm test
  npm pack --pack-destination .
  aws s3 cp "${tarball}" "${s3_dir}/"
}

publish_npm() {
  if [[ -z "${NPM_TOKEN:-}" ]]; then
    echo "NPM_TOKEN is not set (granular access token with publish rights to ${name})." >&2
    exit 1
  fi
  # Temporary .npmrc so the token is never written to the repo or ~/.npmrc.
  local npmrc
  npmrc=$(mktemp)
  trap 'rm -f "$npmrc"' EXIT
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "$npmrc"
  npm publish --userconfig "$npmrc"
}

case "${1:-}" in
  s3)
    # require_clean_git;
    publish_s3 ;;
  npm)
    # require_clean_git;
    publish_npm ;;
  *)   echo "Usage: $0 {s3|npm}" >&2; exit 1 ;;
esac

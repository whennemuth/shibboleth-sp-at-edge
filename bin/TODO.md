# TODO: Publish shibboleth-sp-at-edge from GitHub Actions with npm Trusted Publishing (OIDC)

Replace token-based publishing (`npm run publish-npm`, which uses `NPM_TOKEN`) with a GitHub Actions workflow that npmjs.org trusts directly through OIDC. Nothing secret is stored anywhere. The same workflow can also upload the tarball to the S3 bucket, using AWS OIDC instead of stored AWS keys.

Adapted from the equivalent `shibboleth-sp` TODO - same npm-wide deadlines and OIDC approach, project-specific values (package name, remotes, IAM role, consumer) swapped for this repo. The npmjs.com token-creation page documents the dates below; there's no `discussion.md` in this repo (there wasn't one in `shibboleth-sp` either - a dangling reference in the source document, not copied here).

## Why: npm deadlines

| Date | Change | Status (2026-10-27) |
|---|---|---|
| Nov 2025 | Legacy (classic) tokens removed; only granular access tokens remain | **Past** |
| Aug 2026 | Account-sensitive operations (creating tokens, changing maintainers, package access) need interactive 2FA, which tokens can't bypass | **Past** |
| Jan 2027 | Granular tokens with *Bypass 2FA* lose the ability to publish versions directly. They can only "stage" a version, which a maintainer must approve with 2FA (`npm stage publish` / `npm stage approve <id>`) | **Upcoming** (~2 months) |

Consequences:
- `bin/publish.sh npm` (token + `npm publish`) works only until January 2027. After that, unattended token publishing becomes stage-then-approve-manually.
- Every new token has to be created interactively with 2FA (since August 2026), so renewing tokens can't be scripted either.
- Trusted publishing is npm's recommended replacement. GitHub Actions gets a short-lived credential for each run, and npm automatically attaches provenance (a verified link from the npm version to the commit and workflow).

## When should the workflow publish?

| Approach | How it works | Pros | Cons |
|---|---|---|---|
| **A. Tag or GitHub Release** *(most common)* | Workflow runs on a pushed `v*` tag (or a published GitHub Release). Bump with `npm version minor`, which edits package.json, commits and tags `v1.2.0`; then `git push --follow-tags` | Releases are deliberate and visible in GitHub; the git tag, npm version and S3 tarball always match | One extra step: push the tag |
| **B. Version check on push to `master`** | Workflow runs on every push to `master`; publishes only if the package.json version is newer than `npm view shibboleth-sp-at-edge version` | Fully automatic; bumping the version is the release | A version bump merged by accident publishes immediately; no git tag unless the workflow creates one |
| C. Release tooling (release-please, changesets, semantic-release) | A bot opens a "release PR" with the bump and changelog; merging it tags and publishes | Changelogs, enforced conventions | Commit-message conventions and more moving parts; overkill for one package |

**Recommendation: A, with B's version check as a safety guard.** Trigger on `v*` tags, then before publishing confirm that:
1. the tag equals `v` + the package.json version, and
2. that version is greater than the latest on npmjs.org (`npx semver`), so a re-pushed or out-of-order tag fails clearly instead of reaching npm's error for an existing version.

If you prefer fully automatic releases, use B: same workflow, triggered by `push: branches: [master]` with `paths: [package.json]`. If the check fails, the job ends successfully without publishing instead of failing, and the workflow creates the tag after publishing.

## Decisions needed first

- [ ] **Which GitHub repository publishes?** This repo has two remotes: `github` → `whennemuth/shibboleth-sp-at-edge` and `bu` → `bu-ist/shibboleth-sp-at-edge`. An npm package's trusted publisher is configured for one specific repo and workflow file. Provenance also checks that `repository.url` in package.json (not currently set) matches the repo that ran the workflow. Choose one and add `repository.url` to match it.
- [ ] **Trigger:** A (tags) or B (version check on `master`). See above.
- [ ] **Keep the S3 copy?** If the consumer (`integration-huron-person-fargate`) switches to `"shibboleth-sp-at-edge": "^x.y.z"` from npmjs.org, the S3 upload can be retired. Otherwise keep it as a second job.
- [ ] **Protected environment?** A GitHub *environment* (e.g. `npm-publish`) with required reviewers adds a manual approval click before each publish. npm can also restrict the trusted publisher to that environment name.
- [ ] **Does this package even need to go on the public npm registry?** Today it's consumed via
  the S3 tarball URL only. The `npm` mode below is ready-made parity with `shibboleth-sp`, but
  stays dormant until that's an actual goal.

## Steps

### 1. npmjs.com setup (as the current maintainer, with 2FA)
- [ ] Confirm 2FA is enabled on the account (required since August 2026 for the steps below).
- [ ] Package `shibboleth-sp-at-edge` → Settings → **Trusted Publisher** → GitHub Actions:
  - Organization/user: `whennemuth` (or `bu-ist`)
  - Repository: `shibboleth-sp-at-edge`
  - Workflow filename: `publish.yml`
  - Environment: `npm-publish` (optional, must match the workflow's `environment:`)
- [ ] After the first successful OIDC publish: Settings → Publishing access → **"Require two-factor authentication and disallow tokens"**. Tokens can then no longer publish at all.
- [ ] Revoke any existing granular tokens that have publish rights.

### 2. AWS setup (only if keeping the S3 upload)
- [ ] In the bucket's account, add an IAM OIDC identity provider for `token.actions.githubusercontent.com` (audience `sts.amazonaws.com`), if one doesn't exist yet.
- [ ] Create a role, e.g. `github-shibboleth-sp-at-edge-publish`:
  - Trust policy: allow `sts:AssumeRoleWithWebIdentity` only when `token.actions.githubusercontent.com:sub` is `repo:<owner>/shibboleth-sp-at-edge:ref:refs/tags/v*` (or `repo:<owner>/shibboleth-sp-at-edge:environment:npm-publish`).
  - Permissions: `s3:PutObject` and `s3:ListBucket` limited to `arn:aws:s3:::simple-npm-package-bucket/shibboleth-sp-at-edge/*` and `arn:aws:s3:::simple-npm-package-bucket` with prefix `shibboleth-sp-at-edge/`.

### 3. Repository changes
- [ ] Add `.github/workflows/publish.yml`, starting from the sketch below.
- [ ] Add `repository.url` to `package.json`, matching the publishing repo.
- [ ] Keep `publishConfig` (registry and `access: public`) and `prepublishOnly` (tests + `attw`), if/when public npm publishing is adopted - these would run as part of `npm publish` in CI.
- [ ] `bin/publish.sh`:
  - Keep the `s3` mode for manual emergencies.
  - Remove or label the `npm` mode before **January 2027**. Optionally change it to `npm stage publish` (stage-only token, approved manually with 2FA) as a break-glass fallback.
- [ ] Update the README's packaging/publishing section: the release process becomes "`npm version <patch|minor|major>` then `git push --follow-tags`".

### 4. Workflow sketch (`.github/workflows/publish.yml`, approach A)

```yaml
name: publish
on:
  push:
    tags: ['v*']

permissions:
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: npm-publish          # optional; must match the npm trusted-publisher setting
    permissions:
      contents: read
      id-token: write                 # required for npm trusted publishing and AWS OIDC
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
      - run: npm install -g npm@latest   # trusted publishing needs a recent npm (11.5.1+)
      - run: npm ci

      - name: Check version
        run: |
          version=$(node -p "require('./package.json').version")
          [ "v${version}" = "${GITHUB_REF_NAME}" ] || { echo "Tag ${GITHUB_REF_NAME} != package.json ${version}"; exit 1; }
          published=$(npm view shibboleth-sp-at-edge version 2>/dev/null || echo 0.0.0)
          npx --yes semver -r ">${published}" "${version}" > /dev/null || { echo "${version} is not newer than ${published}"; exit 1; }

      - run: npm publish                 # runs prepublishOnly (tests + attw) and prepack (build); OIDC, no token

      # Optional S3 copy
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::<account-id>:role/github-shibboleth-sp-at-edge-publish
          aws-region: us-east-1
      - run: |
          npm pack --pack-destination .
          aws s3 cp "shibboleth-sp-at-edge-${GITHUB_REF_NAME#v}.tgz" s3://simple-npm-package-bucket/shibboleth-sp-at-edge/
```

For approach B, change the trigger to `push: branches: [master]` with `paths: [package.json]`. Have the version check write a `publish=true|false` step output instead of failing, run the remaining steps only when it is `true`, and add a final step that pushes tag `v${version}` (needs `contents: write`).

Pin third-party actions to commit SHAs once the workflow works.

### 5. First release and cut-over
- [ ] Bump the version (`npm version minor`), push the tag, and watch the run.
- [ ] Check on npmjs.com that the version shows a **provenance** badge linking to the workflow run.
- [ ] Lock publishing to trusted publishing only (step 1, second item) and revoke the old tokens.
- [ ] Update the consumer: `integration-huron-person-fargate` (currently on a `file:`/S3 URL dependency) can move to `"shibboleth-sp-at-edge": "^<version>"`.
- [ ] **Before January 2027:** confirm nothing still depends on `NPM_TOKEN` direct publishing.

## Verification
- A tag that doesn't match package.json fails at "Check version".
- Re-pushing an already-published version fails at "Check version" (not at npm).
- `npm view shibboleth-sp-at-edge --json` shows the new version, and its provenance data points to this repo and workflow.
- If kept, `aws s3 ls s3://simple-npm-package-bucket/shibboleth-sp-at-edge/` lists the new tarball.
- With "disallow tokens" enabled, a local `npm run publish-npm` is rejected.

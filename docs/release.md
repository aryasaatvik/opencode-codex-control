# Releasing

This project uses [Tegami](https://github.com/fuma-nama/tegami) for changelogs,
versioning, npm publication, Git tags, and GitHub Releases. The default release
path runs from the `dev` branch through GitHub Actions and npm trusted
publishing (OIDC, no `NPM_TOKEN`).

## Queue a change

Run `bun run tegami` to create a pending entry under `.tegami/`, or write one
directly:

```md
---
packages:
  "opencode-codex-control": minor
---

## Describe the change

Describe the user-visible result.
```

Commit the changelog entry with the implementation it describes.

## Prepare a version pull request

Start from a clean, current `dev` branch with GitHub CLI authentication:

```sh
bun install --frozen-lockfile
GH_TOKEN="$(gh auth token)" bun run version:packages
```

Tegami consumes the pending entries, updates `package.json` and `CHANGELOG.md`,
writes its publish lock, pushes `tegami/version-packages`, and opens or updates
a pull request against `dev`. Review and merge that pull request before
publishing.

## Publish

After the version pull request is merged, the `publish.yml` workflow runs from
the clean merged `dev` branch, runs the release checks, and then runs:

```sh
bun run release:check && bun run tegami ci
```

The workflow grants GitHub's OIDC token to npm and has no `NPM_TOKEN` secret.
Tegami publishes the package, creates and pushes the `v<version>` Git tag, and
creates the matching GitHub Release.

The npm trusted publisher must be configured as:

- Repository: `aryasaatvik/opencode-codex-control`
- Workflow filename: `publish.yml`
- Environment: blank
- Publishing method: npm publish only

`bun run tegami npm pretrust` can register this from the CLI when npm is
authenticated.

Verify the result:

```sh
npm view opencode-codex-control version
npm view opencode-codex-control dist-tags --json
gh release view "v$(bun -e 'console.log(require("./package.json").version)')"
```

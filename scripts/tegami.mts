import { tegami, type TegamiPlugin } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

import rootPackage from "../package.json" with { type: "json" };

const REPOSITORY = "aryasaatvik/opencode-codex-control";
const PACKAGE_ID = "npm:opencode-codex-control";

/** Tag released versions `vX.Y.Z`, matching the repo's `git tag` convention. */
const versionTag = (): TegamiPlugin => ({
  name: "opencode-codex-control-tag",
  enforce: "post",
  initPublishPlan({ plan }) {
    const pkg = this.graph.get(PACKAGE_ID);
    const packagePlan = plan.packages.get(PACKAGE_ID);
    if (!pkg?.version || !packagePlan) return;

    packagePlan.git ??= {};
    packagePlan.git.tag = `v${pkg.version}`;
  },
});

if (rootPackage.name !== "opencode-codex-control") throw new Error("unexpected release package");

const paper = tegami({
  npm: {
    client: "bun",
    trustedPublish: {
      provider: "github",
      workflow: "publish.yml",
    },
  },
  packages: {
    "opencode-codex-control": {},
  },
  plugins: [
    github({
      repo: REPOSITORY,
      pushTags: true,
      versionPr: {
        branch: "tegami/version-packages",
        base: "dev",
        forceCreate: true,
        create() {
          const version = this.graph.get(PACKAGE_ID)?.version;
          return {
            title: version
              ? `chore(release): prepare ${version}`
              : "chore(release): prepare release",
          };
        },
      },
      release: {
        create({ tag }) {
          return { title: tag };
        },
      },
    }),
    versionTag(),
  ],
});

await runCli(paper);

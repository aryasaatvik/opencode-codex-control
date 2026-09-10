// Adapted from Executor (MIT, Copyright (c) 2026 Rhys Sullivan). See NOTICE.
// macOS permission failures for the Codex surfaces.
//
// These tools drive the real machine, so macOS gates them behind TCC. The
// plugin reports a bare Apple Event error code, which reaches a caller as an
// opaque "Unknown error". Classifying it here turns the most common first-run
// failure into something a person can act on: which System Settings pane, and
// which exact entry, to enable.

const settingsUrl = (pane: string): string =>
  `x-apple.systempreferences:com.apple.preference.security?${pane}`;

export interface CodexPermission {
  readonly id: "automation" | "accessibility" | "screen-recording";
  readonly label: string;
  readonly entry: string;
  readonly why: string;
  readonly settingsUrl: string;
}

/**
 * Automation is per-HOST: macOS attributes the Apple Event to the responsible
 * process — the app that launched the chain, here OpenCode. Screen Recording
 * and Accessibility attach to the Codex Computer Use app and are shared across
 * every host, so granting them once in Codex covers this plugin too.
 */
export const CODEX_PERMISSIONS: Readonly<Record<string, readonly CodexPermission[]>> = {
  "computer_use": [
    {
      id: "screen-recording",
      label: "Screen Recording",
      entry: "Codex Computer Use",
      why: "so it can see the app it is operating",
      settingsUrl: settingsUrl("Privacy_ScreenCapture"),
    },
    {
      id: "accessibility",
      label: "Accessibility",
      entry: "Codex Computer Use",
      why: "so it can click, type, and scroll",
      settingsUrl: settingsUrl("Privacy_Accessibility"),
    },
  ],
  "browser": [
    {
      id: "automation",
      label: "Automation",
      entry: "OpenCode → Google Chrome",
      why: "so it can drive your browser",
      settingsUrl: settingsUrl("Privacy_Automation"),
    },
  ],
};

/** Apple Event failures that mean "the user has not allowed this".
 *  `-1743` is `errAEEventNotPermitted`; `-600`/`-609` are the connection
 *  errors macOS returns when it refuses to hand the sender a port. */
const deniedCodePattern = /(?:^|[^0-9-])(-1743|-609|-600)(?![0-9])/;

/** A permission failure recognised in an upstream tool error, or null when
 *  the error is about something else. Matching is on the numeric code, not on
 *  wording: the plugin's own text is "Unknown error". */
export const permissionFailure = (
  message: string,
  surface: string | undefined,
): CodexPermission | null => {
  if (!deniedCodePattern.test(message)) return null;
  const permissions = surface === undefined ? [] : (CODEX_PERMISSIONS[surface] ?? []);
  return permissions.find((p) => p.id === "automation") ?? permissions[0] ?? null;
};

/** The message a caller sees instead of "Unknown error". It names the block,
 *  the exact entry to enable, and where, because macOS will not ask again on
 *  its own after a denial. */
export const permissionFailureMessage = (permission: CodexPermission): string =>
  [
    `macOS blocked this: ${permission.label} access has not been allowed.`,
    `Open System Settings → Privacy & Security → ${permission.label}, find "${permission.entry}", and turn it on — ${permission.why}.`,
    "macOS only asks once, so a prompt will not appear again until it is enabled there.",
  ].join(" ");

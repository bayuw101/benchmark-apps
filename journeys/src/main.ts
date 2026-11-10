/*
 * Runner entry point (bundled to dist/main.js and baked into the runner image).
 * The worker passes the whole run as BTB_RUN_CONFIG; this picks the journey, builds the k6 options from it
 * and refuses to start when the config or the target is outside policy.
 */
import { K6_SUMMARY_MARKER, RUNNER_CONFIG_ENV, type ParamValue } from "@btb/contracts";
import exec from "k6/execution";
import {
  finalCallback,
  leaseCheckIn,
  loadTestData,
  optionsOf,
  parseRunnerConfig,
  segmentSlice,
  sendCallback,
  targetClient,
  verifyRun,
  visitPage,
  type JourneyContext,
  type SummaryData,
  type Visit,
} from "@btb/k6-lib";

import { page as browseEventPage, run as browseEvent } from "./browse-event";
import { JOURNEY_CATALOG } from "./catalog";
import { run as checkout } from "./checkout";
import { run as receivePoll } from "./receive-poll";
import { run as scanTicket } from "./scan-ticket";

const RUNNERS: Record<string, (ctx: JourneyContext) => void> = {
  "browse-event": browseEvent,
  checkout,
  "receive-poll": receivePoll,
  "scan-ticket": scanTicket,
};

/** Browser halves, for journeys with `browser: true`. */
const BROWSER_RUNNERS: Record<string, (ctx: JourneyContext, visit: Visit) => Promise<void>> = {
  "browse-event": browseEventPage,
};

const config = parseRunnerConfig(__ENV[RUNNER_CONFIG_ENV]);
const journey = JOURNEY_CATALOG.find((j) => j.id === config.journey);
const runJourney = RUNNERS[config.journey];
if (!journey || !runJourney) throw new Error(`unknown journey: ${config.journey}`);
const runBrowser = BROWSER_RUNNERS[config.journey];
if (config.browser && !(journey.browser && runBrowser)) throw new Error(`journey ${config.journey} has no browser steps`);

// Unknown params are dropped; missing ones take the catalog default.
const params: Record<string, ParamValue> = Object.fromEntries(journey.params.map((p) => [p.name, config.params[p.name] ?? p.default]));
// Read in the init context (k6 `open`); a missing or bad Secret makes setup() refuse, so no load starts without it.
const testData = loadTestData(config);
let mine: unknown[] | undefined;
const identities = () => {
  if (!testData || "problem" in testData) return [];
  mine ??= segmentSlice(testData.identities, (exec.test.options as { executionSegment?: string }).executionSegment);
  return mine;
};
const ctx: JourneyContext = { http: targetClient(config), params, identities };

export const options = optionsOf(config);

/** Self-check before any load (E5.3): aborts the test unless the platform's approved manifest is this config. */
export function setup() {
  return verifyRun(config, testData && "problem" in testData ? [testData.problem] : []);
}

export default function () {
  runJourney(ctx);
}

/** The lease scenario (LEASE_EXEC). */
export function lease() {
  leaseCheckIn(config);
}

/** The browser scenario (BROWSER_EXEC); only scheduled when the config has a browser block. */
export async function browser() {
  await runBrowser(ctx, (step, path, act) => visitPage(config, step, path, act));
}

/** Reports the pod's result (signed callback) and replaces the text summary with one JSON line the worker picks out of the pod log. */
export function handleSummary(data: SummaryData) {
  // setup_data is missing when the self-check refused; that pod already reported.
  if (data.setup_data?.verified) {
    const { event, ...facts } = finalCallback(data, config.durationSec);
    sendCallback(config, event, facts);
  }
  return { stdout: `\n${K6_SUMMARY_MARKER}${JSON.stringify(data)}\n` };
}

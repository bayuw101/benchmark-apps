import type { JourneyMeta } from "@btb/contracts";

import { meta as browseEvent } from "./browse-event/meta";
import { meta as checkout } from "./checkout/meta";
import { meta as receivePoll } from "./receive-poll/meta";
import { meta as scanTicket } from "./scan-ticket/meta";

/** Every journey in the runner image. Metadata only (no k6 imports): the build writes it to catalog.json. */
export const JOURNEY_CATALOG: JourneyMeta[] = [browseEvent, checkout, receivePoll, scanTicket];

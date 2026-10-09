import type { StakehouseClient } from '@stakehouse/api-client';
import { createClient } from '@stakehouse/api-client';

/** The app's one client — same-origin, cookie-carrying. Tests inject fakes
 * through ApiProvider instead of touching this module. */
export const api: StakehouseClient = createClient();

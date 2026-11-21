import { config } from "zod";

// The page's Content-Security-Policy forbids eval, so tell zod not to probe for it. This module is
// imported first in main.tsx because zod checks the setting when schemas are created.
config({ jitless: true });

/**
 * Weekly Planning Cron Endpoint
 *
 * Schedule: Sunday at 8:00pm (configured in vercel.json as UTC)
 */

import { createApiHandler, validateCronSecret } from "../utils/handler.js";
import { runWeeklyPlan } from "../../src/cron/weekly-plan.js";

export default createApiHandler({
  allowedMethods: ["GET"],
  validateSecret: validateCronSecret,
  errorLabel: "Weekly plan",
  handler: async () => runWeeklyPlan(),
});

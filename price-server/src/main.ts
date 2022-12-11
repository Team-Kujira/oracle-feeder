import * as bluebird from "bluebird";
import * as config from "config";
import { errorHandler, init as initErrorHandler } from "lib/error";
import * as logger from "lib/logger";
import { setupMetricsServer } from "lib/metrics";
import { initialize as initializeProviders, tick } from "provider";
import { createServer } from "./server";

bluebird.config({ longStackTraces: true });
// @ts-expect-error global
global.Promise = bluebird;

async function main(): Promise<void> {
  logger.info("price server start");

  initErrorHandler({ sentry: config.sentry });

  await setupMetricsServer();
  await initializeProviders();
  await createServer();

  await loop();
}

async function loop(): Promise<void> {
  while (true) {
    await tick(Date.now());

    await bluebird.delay(10);
  }
}

if (require.main === module) {
  main().catch(errorHandler);
}

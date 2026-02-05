import pino from "pino";
import type { Config } from "../config/schema.js";

export const createLogger = (config: Config) =>
  pino({
    level: config.logLevel
  });

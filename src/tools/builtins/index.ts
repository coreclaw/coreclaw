import type { ToolSpec } from "../registry.js";
import { fsTools } from "./fs.js";
import { shellTools } from "./shell.js";
import { webTools } from "./web.js";
import { memoryTools } from "./memory.js";
import { messageTools } from "./message.js";
import { taskTools } from "./tasks.js";
import { skillTools } from "./skills.js";
import { busTools } from "./bus.js";

export const builtInTools = (): ToolSpec<any>[] => [
  ...fsTools(),
  ...shellTools(),
  ...webTools(),
  ...memoryTools(),
  ...messageTools(),
  ...taskTools(),
  ...skillTools(),
  ...busTools()
];

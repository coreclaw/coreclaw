export const nowIso = () => new Date().toISOString();

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

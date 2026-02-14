export type HeartbeatWakeEvent = {
  reason?: string;
  force?: boolean;
  channel?: string;
  chatId?: string;
};

export type HeartbeatEventSource = {
  name: string;
  start: (emit: (event: HeartbeatWakeEvent) => void) => void | (() => void);
};

export const createIntervalHeartbeatSource = (
  intervalMs: number
): HeartbeatEventSource => ({
  name: "interval",
  start(emit) {
    const timer = setInterval(() => {
      emit({ reason: "heartbeat:tick" });
    }, intervalMs);
    timer.unref?.();
    emit({ reason: "heartbeat:startup" });

    return () => {
      clearInterval(timer);
    };
  }
});

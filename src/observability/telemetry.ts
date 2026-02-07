type ToolMetric = {
  calls: number;
  failures: number;
  totalLatencyMs: number;
  maxLatencyMs: number;
};

type SchedulerMetric = {
  dispatches: number;
  tasks: number;
  totalDelayMs: number;
  maxDelayMs: number;
};

export class RuntimeTelemetry {
  private toolMetrics = new Map<string, ToolMetric>();
  private schedulerMetric: SchedulerMetric = {
    dispatches: 0,
    tasks: 0,
    totalDelayMs: 0,
    maxDelayMs: 0
  };

  recordToolExecution(name: string, durationMs: number, success: boolean) {
    const metric = this.toolMetrics.get(name) ?? {
      calls: 0,
      failures: 0,
      totalLatencyMs: 0,
      maxLatencyMs: 0
    };

    metric.calls += 1;
    if (!success) {
      metric.failures += 1;
    }
    metric.totalLatencyMs += durationMs;
    metric.maxLatencyMs = Math.max(metric.maxLatencyMs, durationMs);
    this.toolMetrics.set(name, metric);
  }

  recordSchedulerDispatch(delaysMs: number[]) {
    this.schedulerMetric.dispatches += 1;
    this.schedulerMetric.tasks += delaysMs.length;
    for (const delay of delaysMs) {
      this.schedulerMetric.totalDelayMs += delay;
      this.schedulerMetric.maxDelayMs = Math.max(this.schedulerMetric.maxDelayMs, delay);
    }
  }

  snapshot() {
    const toolEntries = [...this.toolMetrics.entries()].map(([name, metric]) => ({
      name,
      calls: metric.calls,
      failures: metric.failures,
      failureRate: metric.calls > 0 ? metric.failures / metric.calls : 0,
      avgLatencyMs: metric.calls > 0 ? metric.totalLatencyMs / metric.calls : 0,
      maxLatencyMs: metric.maxLatencyMs
    }));

    const toolTotals = toolEntries.reduce(
      (acc, entry) => {
        acc.calls += entry.calls;
        acc.failures += entry.failures;
        return acc;
      },
      { calls: 0, failures: 0 }
    );

    return {
      tools: {
        totals: {
          calls: toolTotals.calls,
          failures: toolTotals.failures,
          failureRate:
            toolTotals.calls > 0 ? toolTotals.failures / toolTotals.calls : 0
        },
        byName: toolEntries.sort((a, b) => b.calls - a.calls)
      },
      scheduler: {
        dispatches: this.schedulerMetric.dispatches,
        tasks: this.schedulerMetric.tasks,
        avgDelayMs:
          this.schedulerMetric.tasks > 0
            ? this.schedulerMetric.totalDelayMs / this.schedulerMetric.tasks
            : 0,
        maxDelayMs: this.schedulerMetric.maxDelayMs
      }
    };
  }
}

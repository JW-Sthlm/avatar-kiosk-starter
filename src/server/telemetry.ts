import appInsights from "applicationinsights";

type Props = Record<string, string | number | boolean | undefined>;

let initialized = false;

function sanitize(properties?: Props): Record<string, string> | undefined {
  if (!properties) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : String(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function initTelemetry(roleName = "assistant-avatar-broker"): void {
  if (initialized) return;
  const connectionString =
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim() ||
    process.env.APPINSIGHTS_INSTRUMENTATIONKEY?.trim();

  if (!connectionString) {
    console.log("[telemetry] APPLICATIONINSIGHTS_CONNECTION_STRING not set; telemetry disabled.");
    return;
  }

  try {
    appInsights
      .setup(connectionString)
      .setAutoCollectRequests(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectConsole(true, true)
      .setAutoCollectPerformance(true, true)
      .setSendLiveMetrics(false)
      .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
      .start();

    const client = appInsights.defaultClient;
    if (client) {
      client.context.tags[client.context.keys.cloudRole] = roleName;
      client.context.tags[client.context.keys.cloudRoleInstance] =
        process.env.WEBSITE_INSTANCE_ID || process.env.HOSTNAME || "local";
    }

    initialized = true;
    console.log(`[telemetry] Application Insights enabled (role: ${roleName}).`);
  } catch (error) {
    console.error("[telemetry] Failed to initialize Application Insights:", error);
  }
}

// Auto-init on first import so HTTP/dependency auto-collection patches
// install before express transitively requires `http`.
initTelemetry();

export const track = {
  event(name: string, properties?: Props): void {
    if (!initialized) return;
    try {
      appInsights.defaultClient.trackEvent({ name, properties: sanitize(properties) });
    } catch {
      // never let telemetry break the request path
    }
  },
  exception(error: unknown, properties?: Props): void {
    if (!initialized) return;
    try {
      const err = error instanceof Error ? error : new Error(String(error));
      appInsights.defaultClient.trackException({ exception: err, properties: sanitize(properties) });
    } catch {
      /* ignore */
    }
  },
  metric(name: string, value: number, properties?: Props): void {
    if (!initialized) return;
    try {
      appInsights.defaultClient.trackMetric({ name, value, properties: sanitize(properties) });
    } catch {
      /* ignore */
    }
  }
};

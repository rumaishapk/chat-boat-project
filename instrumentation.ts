import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Sentry initialize
    await import("./sentry.server.config");

    // OpenTelemetry initialize
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");

    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [getNodeAutoInstrumentations()],
    });

    sdk.start();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
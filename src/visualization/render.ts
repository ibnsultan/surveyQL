/**
 * Browser-only renderers. Never imported from the CLI or the core entry points.
 */
import type { ChartValue } from "../interpreter/values";
import type { Dataset } from "../surveycore/dataset";

export interface ChartHandle {
  destroy(): void;
}

/**
 * Render a chart value with ApexCharts into `el`. Loaded lazily: the library expects a DOM.
 */
export async function renderApex(value: ChartValue, el: HTMLElement): Promise<ChartHandle> {
  const mod = await import("apexcharts");
  const ApexCharts = (mod as { default?: unknown }).default ?? mod;
  const options = structuredClone(value.spec.apex) as Record<string, unknown>;
  const type = (options.chart as { type?: string } | undefined)?.type;
  if (type === "bar" || type === "line") {
    // Print real, thousands-separated numbers from `spec.data`: plotted values may be percentages
    // (independent scales), and a horizontal "track" series prints its group's value or total.
    const raw = value.spec.data.series;
    const meta = (options.series as { track?: number[] }[]) ?? [];
    const fmt = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    const real = (_v: unknown, ctx: { seriesIndex: number; dataPointIndex: number }): string => {
      const members = meta[ctx.seriesIndex]?.track ?? [ctx.seriesIndex];
      const values = members.map((i) => raw[i]?.values[ctx.dataPointIndex]).filter((x): x is number => typeof x === "number");
      return values.length ? fmt(values.reduce((a, b) => a + b, 0)) : "";
    };
    options.dataLabels = { ...(options.dataLabels as object), formatter: real };
    options.tooltip = { ...(options.tooltip as object), y: { formatter: real } };
  }
  const chart = new (ApexCharts as new (el: HTMLElement, o: unknown) => { render(): Promise<void>; destroy(): void })(el, options);
  await chart.render();
  return { destroy: () => chart.destroy() };
}

const SA_CHART_TYPES: Record<string, string> = {
  bar: "bar",
  vbar: "vbar",
  pie: "pie",
  doughnut: "doughnut",
  hist: "vhistogram",
  line: "line",
  gauge: "gauge",
};

export type SurveyAnalyticsHandle = ChartHandle;

/**
 * Render with survey-analytics' own visualizer (its ApexCharts build) for the question. Loaded
 * lazily because the package touches `document` at import time.
 */
export async function renderSurveyAnalytics(value: ChartValue, ds: Dataset, el: HTMLElement): Promise<SurveyAnalyticsHandle> {
  if (value.spec.mode === "series") {
    throw new Error("survey-analytics cannot draw series charts (against/with); use renderApex");
  }
  const sa = await import("survey-analytics/survey.analytics.apexcharts");
  if (!ds.model) throw new Error("survey-analytics cannot draw a combined (union/join) dataset; use renderApex");
  const questionName = value.question.split(".")[0];
  const question = ds.model.getQuestionByName(questionName);
  if (!question) throw new Error(`survey-analytics: question '${questionName}' not found`);
  const chartType = SA_CHART_TYPES[value.chartType] ?? "bar";
  const visualizer = sa.VisualizerFactory.createVisualizer(question, ds.rows, {
    defaultChartType: chartType,
    allowChangeVisualizerType: true,
  } as never) as unknown as {
    chartType?: string;
    chartTypes?: string[];
    setChartType?: (t: string) => void;
    render(el: HTMLElement): void;
    destroy(): void;
  };
  if (visualizer.chartTypes?.includes(chartType)) {
    if (typeof visualizer.setChartType === "function") visualizer.setChartType(chartType);
    else visualizer.chartType = chartType;
  }
  visualizer.render(el);
  return { destroy: () => visualizer.destroy() };
}

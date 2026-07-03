import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChartModule } from 'primeng/chart';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { BenchStore } from '../../core/state/bench.store';
import { BenchmarkResult } from '../../core/models/types';
import {
  fmt,
  fmtGB,
  fmtSec,
  backendLabel,
  deviceVramLine,
  modelBase,
  parseModel,
  shortModel,
} from '../../core/utils/format';

/**
 * Métrica graficable: clave + etiqueta + extractor del valor numérico + unidad.
 * Solo se ofrecen métricas numéricas con sentido para un bar chart comparativo.
 */
interface ChartMetric {
  /** Clave identificadora (la persisten/leen los selects internos). */
  key: string;
  /** Etiqueta legible mostrada en el selector y como título del eje Y. */
  label: string;
  /** Extrae el valor numérico de un resultado; null si no aplica. */
  value: (r: BenchmarkResult) => number | null;
  /** Unidad del eje (p.ej. "t/s", "s", "GB"). */
  unit: string;
  /** True si un valor MENOR es mejor (p.ej. tiempos): invierte el color del "best". */
  lowerIsBetter?: boolean;
}

/**
 * Catálogo de métricas disponibles para el selector del chart.
 * El orden aquí es el orden del selector; el default (key 'genTps')
 * corresponde a "Generation speed", como pide la spec.
 */
const METRICS: ChartMetric[] = [
  {
    key: 'genTps',
    label: 'Generation speed',
    unit: 't/s',
    value: (r) => r.generationTokensPerSecond,
  },
  { key: 'promptTps', label: 'Prompt speed', unit: 't/s', value: (r) => r.promptTokensPerSecond },
  {
    key: 'generationTime',
    label: 'Generation time',
    unit: 's',
    lowerIsBetter: true,
    value: (r) => (r.generationTimeMs != null ? r.generationTimeMs / 1000 : null),
  },
  {
    key: 'promptTime',
    label: 'Prompt processing time',
    unit: 's',
    lowerIsBetter: true,
    value: (r) => (r.promptEvalTimeMs != null ? r.promptEvalTimeMs / 1000 : null),
  },
  {
    key: 'loadTime',
    label: 'Load time',
    unit: 's',
    lowerIsBetter: true,
    value: (r) => r.loadTimeSeconds,
  },
  {
    key: 'latency',
    label: 'Request latency',
    unit: 's',
    lowerIsBetter: true,
    value: (r) => (r.requestLatencyMs != null ? r.requestLatencyMs / 1000 : null),
  },
  { key: 'draftAcc', label: 'Draft acceptance', unit: '', value: (r) => r.draftAcceptance },
  {
    key: 'totalVram',
    label: 'Total VRAM',
    unit: 'GB',
    lowerIsBetter: true,
    value: (r) => (sumVramMiB(r) != null ? sumVramMiB(r)! / 1024 : null),
  },
  {
    key: 'ram',
    label: 'RAM',
    unit: 'GB',
    lowerIsBetter: true,
    value: (r) => (r.ramUsedMiB != null ? r.ramUsedMiB / 1024 : null),
  },
  { key: 'ctx', label: 'Context size', unit: '', value: (r) => r.config?.ctxSize ?? null },
  { key: 'genTokens', label: 'Generated tokens', unit: '', value: (r) => r.generationTokenCount },
];

/** Suma de VRAM usada en MiB (deviceVram del backend, fallback a gpus legacy). */
function sumVramMiB(r: BenchmarkResult): number | null {
  if (r.deviceVram && r.deviceVram.length > 0) {
    const total = r.deviceVram.reduce((s, d) => s + (d.usedMiB ?? 0), 0);
    return total > 0 ? total : null;
  }
  const total = (r.gpus || []).reduce((s, g) => s + (g.memUsedMiB ?? 0), 0);
  return total > 0 ? total : null;
}

/**
 * ChartModal: diálogo full-screen con un bar chart comparando los resultados
 * seleccionados. Cada barra es un resultado; el label es "id-modeloBase"
 * (p.ej. "1-Qwen3.6"). El hover de cada barra muestra los datos completos del
 * modelo (velocidades, tiempos, params…). Un selector elige la métrica del
 * eje Y (default: Generation speed). Visible cuando store.showChart() es true.
 */
@Component({
  selector: 'app-chart-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DialogModule, ChartModule, SelectModule],
  templateUrl: './chart-modal.html',
  styleUrl: './chart-modal.css',
})
export class ChartModal {
  protected readonly store = inject(BenchStore);
  private readonly platformId = inject(PLATFORM_ID);

  /** Métricas disponibles para el selector. */
  protected readonly metrics = METRICS;
  /** Opciones del selector (label visible). */
  protected readonly metricOptions = METRICS.map((m) => ({ label: m.label, value: m.key }));

  /** Métrica seleccionada (default: 'genTps' → Generation speed). */
  protected readonly selectedMetric = signal<string>('genTps');

  /** Resultados seleccionados para graficar. */
  protected readonly items = computed<BenchmarkResult[]>(() => this.store.selectedResults());

  /** Métrica activa como objeto (buscada por key). */
  private readonly metric = computed<ChartMetric>(
    () => METRICS.find((m) => m.key === this.selectedMetric()) ?? METRICS[0],
  );

  /** Two-way binding del visible: sincroniza con store.showChart. */
  protected get visible(): boolean {
    return this.store.showChart();
  }
  protected set visible(v: boolean) {
    if (!v) this.store.closeChart();
  }

  /** Setter del selector: actualiza la métrica (string key). */
  protected onMetricChange(key: string): void {
    this.selectedMetric.set(key);
  }

  /**
   * Label de cada barra como array (Chart.js lo renderiza multi-línea):
   *   ["1-Qwen3.6", "Q4_K_M"]
   * La primera línea es el índice + modelo base; la segunda, la quantización.
   * Si no hay quant, la segunda línea queda vacía para que todas las barras
   * mantengan la misma altura de label (y ancho consistente). Así el modelo y
   * su quant se separan visualmente en vez de mezclarse en una sola línea.
   */
  private barLabel(r: BenchmarkResult, idx: number): string[] {
    const base = modelBase(r.config?.model) ?? 'modelo';
    const p = parseModel(r.config?.model);
    const quant = p?.quant ?? '';
    return [`${idx + 1}-${base}`, quant];
  }

  /**
   * Tooltip HTML de cada barra: todos los datos relevantes del modelo.
   * Se alimenta a Chart.js vía callbacks.label (multi-línea) → cada elemento
   * del array es una línea del tooltip.
   */
  private tooltipLines(r: BenchmarkResult): string[] {
    const c = r.config;
    const p = parseModel(c?.model);
    const lines = [
      shortModel(c?.model),
      p?.quant ? `- Quant: ${p.quant}` : '',
      `- Prompt speed: ${fmt(r.promptTokensPerSecond)} t/s`,
      `- Gen speed: ${fmt(r.generationTokensPerSecond)} t/s`,
      `- Generation time: ${fmtSec(r.generationTimeMs)} s`,
      `- Prompt time: ${fmtSec(r.promptEvalTimeMs)} s`,
      `- Load time: ${fmt(r.loadTimeSeconds, 2)} s`,
      `- Draft acc: ${fmt(r.draftAcceptance, 3)}`,
      `- ctx: ${c?.ctxSize ?? '—'} · batch: ${c?.batchSize ?? '—'}/${c?.ubatchSize ?? '—'}`,
      `- cache: ${c?.cacheTypeK ?? '—'}/${c?.cacheTypeV ?? '—'}`,
      `- device: ${c?.device ?? '—'} · ${backendLabel(r.backend) || '—'}`,
      `- VRAM: ${deviceVramLine(r, true) || '—'}`,
      `- RAM: ${fmtGB(r.ramUsedMiB, 2)} GB`,
    ];
    return lines.filter((l) => l !== '');
  }

  /** Configuración (data + options) del chart, recomputada por métrica/ítems. */
  protected readonly chartData = computed(() => {
    const items = this.items();
    const metric = this.metric();
    if (!items.length || !isPlatformBrowser(this.platformId)) {
      return { labels: [], datasets: [] };
    }

    const labels = items.map((r, i) => this.barLabel(r, i));
    const data = items.map((r) => metric.value(r));

    // Índice del "mejor" valor para resaltarlo (mayor o menor según la métrica).
    let bestIdx = -1;
    let bestVal: number | null = null;
    data.forEach((v, i) => {
      if (v == null) return;
      if (bestVal == null) {
        bestVal = v;
        bestIdx = i;
      } else if (metric.lowerIsBetter ? v < bestVal : v > bestVal) {
        bestVal = v;
        bestIdx = i;
      }
    });

    const colors = data.map(
      (_, i) =>
        i === bestIdx
          ? 'rgba(34, 197, 94, 0.55)' // verde: mejor
          : 'rgba(59, 130, 246, 0.45)', // azul: resto
    );
    const borders = data.map((_, i) => (i === bestIdx ? 'rgb(34, 197, 94)' : 'rgb(59, 130, 246)'));

    return {
      labels,
      datasets: [
        {
          label: metric.label,
          data,
          backgroundColor: colors,
          borderColor: borders,
          borderWidth: 1,
        },
      ],
    };
  });

  /** Tooltip (líneas) por barra, indexado por orden de ítems. */
  private readonly tooltips = computed<string[][]>(() =>
    this.items().map((r) => this.tooltipLines(r)),
  );

  /** Opciones del chart; el tooltip usa callbacks.label multi-línea. */
  protected readonly chartOptions = computed(() => {
    if (!isPlatformBrowser(this.platformId)) return {};
    const ds = getComputedStyle(document.documentElement);
    const textColor = ds.getPropertyValue('--color-text') || '#f0efed';
    const textColorSecondary = ds.getPropertyValue('--color-text-muted') || '#9b9b96';
    const surfaceBorder = ds.getPropertyValue('--color-border') || 'rgba(255,255,255,0.1)';
    const metric = this.metric();
    const tooltips = this.tooltips();

    return {
      maintainAspectRatio: false,
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // Título = primera línea del label de la barra ("1-Qwen3.6"); la
            // quant va aparte en el cuerpo del tooltip. ctx.label puede ser
            // string (label simple) o string[] (label multi-línea del eje X).
            title: (ctx: { label: string | string[] }[]) => {
              const l = ctx[0]?.label;
              return Array.isArray(l) ? (l[0] ?? '') : (l ?? '');
            },
            label: (ctx: { dataIndex: number }) => tooltips[ctx.dataIndex] ?? [],
          },
        },
      },
      scales: {
        x: {
          ticks: { color: textColorSecondary, autoSkip: false, maxRotation: 45, minRotation: 0 },
          grid: { color: surfaceBorder },
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: metric.unit ? `${metric.label} (${metric.unit})` : metric.label,
            color: textColorSecondary,
          },
          ticks: { color: textColorSecondary },
          grid: { color: surfaceBorder },
        },
      },
    };
  });
}

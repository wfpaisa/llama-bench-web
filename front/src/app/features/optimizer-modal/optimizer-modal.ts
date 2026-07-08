import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { SliderModule } from 'primeng/slider';
import { MultiSelectModule } from 'primeng/multiselect';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { BenchStore } from '../../core/state/bench.store';
import { LlamaBenchService } from '../../core/services/llama-bench.service';
import { applyTunedParams, parseParamsFromScript } from '../../core/utils/flag-writer';
import {
  buildBreakdown,
  totalFreeFor,
  KV_TYPES,
} from '../../core/utils/vram-estimate';
import { fmtGB, fmt, backendLabel } from '../../core/utils/format';
import type {
  LlamaDevice,
  ModelMeta,
  TunedParams,
  VramBreakdown,
} from '../../core/models/types';

/** Tope físico de ctx-size: --context-length máximo del binario (256K). */
const CTX_MAX = 262_144;

/** Opciones de tipo de KV cache (K y V). */
const KV_OPTIONS = KV_TYPES.map((v) => ({ label: v.toUpperCase(), value: v }));

/** Fila de consumo por device para render del breakdown. */
interface DeviceBar {
  device: LlamaDevice;
  /** MiB consumidos estimados por el modelo (heurística inflada por vendor). */
  usedMiB: number;
  /** MiB que ya estaban en uso al abrir (snapshot total − free). 0 si el switch está off. */
  baselineMiB: number;
  /** % del modelo sobre la VRAM total del device. */
  pct: number;
  /** % combinado (modelo + baseline) sobre la VRAM total. */
  totalPct: number;
  /** True si (modelo + baseline) desborda la VRAM total del device. */
  overflow: boolean;
}

/**
 * OptimizerModal: diálogo para precalcular parámetros de llama-server según los recursos.
 *
 * La estimación es puramente heurística (pesos reales del .gguf + KV cache con
 * arquitectura del header GGUF + overhead), calculada client-side como `computed`
 * → los sliders actualizan las barras en vivo sin llamadas HTTP por cada cambio.
 *
 * El único HTTP es al abrir el diálogo (POST /estimate: obtiene devices vía
 * --list-devices + resuelve el archivo del modelo y lee su header GGUF).
 *
 * Controles: ctx-size, n-gpu-layers, batch/ubatch, KV cache K/V, devices,
 * tensor-split (slider por device), --cpu-moe, --cache-reuse, --flash-attn,
 * --no-mmproj. Botón "Default" restaura los valores de llama-server --help.
 *
 * Estado: copia temporal local (no toca el script del editor hasta "Aplicar").
 */
@Component({
  selector: 'app-optimizer-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    SelectModule,
    SliderModule,
    MultiSelectModule,
    ToggleSwitchModule,
    TooltipModule,
  ],
  templateUrl: './optimizer-modal.html',
  styleUrl: './optimizer-modal.css',
})
export class OptimizerModal {
  protected readonly store = inject(BenchStore);
  private readonly api = inject(LlamaBenchService);
  private readonly messages = inject(MessageService);

  protected readonly kvOptions = KV_OPTIONS;

  // ── Estado del diálogo (copia temporal, no toca el store) ──
  protected readonly params = signal<TunedParams>(this.defaultParams());

  /** Devices + meta cargados una sola vez al abrir (vía /estimate del backend). */
  protected readonly devices = signal<LlamaDevice[]>([]);
  protected readonly meta = signal<ModelMeta | null>(null);
  /** Error al cargar devices (p.ej. binario no encontrado). */
  protected readonly loadError = signal<string | null>(null);

  protected readonly loadingDevices = signal(false);

  /**
   * Snapshot de la VRAM ya usada por device al abrir el diálogo
   * (totalMiB − freeMiB). No se recalcula: captura el estado del momento para
   * que el "Consumo estimado" pueda sumar la memoria ocupada por otros
   * procesos (display server, otras apps, otro modelo cargado…).
   * Clave: id del device → MiB usados.
   */
  private readonly baselineUsedByDevice = signal<Record<string, number>>({});

  /**
   * Switch "vram disponible" (activo por defecto). Cuando está on, el consumo
   * estimado suma la VRAM que ya estaba en uso al abrir el diálogo, para reflejar
   * la memoria realmente libre para el modelo.
   */
  protected readonly countUsedVram = signal(true);

  /**
   * Offset de calibración manual (MiB, con signo). Ajuste opcional para que la
   * heurística coincida con el uso real medido: positivo suma consumo (p.ej.
   * +500 si el real fue mayor), negativo lo resta. Default 0. Se persiste en
   * data/vram-offset.txt vía el backend; se carga una vez al abrir.
   */
  protected readonly offsetMiB = signal(0);

  /** True cuando los params ya se sembraron al abrir (evita resembrar en reopen). */
  private seeded = false;

  /** True cuando el offset persistido ya se cargó (evita recargar en reopen). */
  private offsetLoaded = false;

  // ── Derivados (computed, sin HTTP) ──

  /** Heurística de consumo calculada client-side (instantánea, inflada por vendor). */
  protected readonly heuristic = computed<VramBreakdown | null>(() => {
    const meta = this.meta();
    const devices = this.devices();
    if (!meta || devices.length === 0) return null;
    return buildBreakdown(meta, this.params(), devices);
  });

  /** VRAM total libre de los devices seleccionados. */
  protected readonly totalFreeMiB = computed(() => totalFreeFor(this.devices(), this.params().device));

  /** Opciones para el multiselect de devices. */
  protected readonly deviceOptions = computed(() =>
    this.devices().map((d) => ({
      label: `${d.id} · ${d.name} (${fmtGB(d.totalMiB, 1)} GB, ${fmtGB(d.freeMiB, 1)} libres)`,
      value: d.id,
    })),
  );

  /** Devices que participan en el reparto (selección o todos). */
  protected readonly selectedDevices = computed<LlamaDevice[]>(() => {
    const sel = this.params().device;
    return sel.length ? this.devices().filter((d) => sel.includes(d.id)) : this.devices();
  });

  /**
   * Sliders de tensor-split: uno por device seleccionado, con el valor actual
   * (o un default uniforme si tensorSplit es null/automático). Un slider [0,10]
   * por device; 0 = excluirlo del reparto.
   */
  protected readonly tensorSplitItems = computed<{ device: LlamaDevice; value: number }[]>(() => {
    const devices = this.selectedDevices();
    const ts = this.params().tensorSplit;
    return devices.map((d, i) => ({ device: d, value: ts?.[i] ?? 1 }));
  });

  /** True si tensor-split está en modo automático (null). */
  protected readonly tensorSplitAuto = computed(() => this.params().tensorSplit === null);

  /** Bars por device (de la heurística). */
  protected readonly bars = computed<DeviceBar[]>(() => {
    const h = this.heuristic();
    const devices = this.selectedDevices();
    if (!h || devices.length === 0) return [];
    const countBaseline = this.countUsedVram();
    const baseline = this.baselineUsedByDevice();
    // El offset de calibración se reparte entre los devices proporcionalmente al
    // consumo del modelo, para que las barras reflejen el ajuste del usuario.
    const offset = this.offsetMiB();
    const totalModel = devices.reduce((s, _, i) => s + (h.perDeviceMiB[i] ?? 0), 0) || 1;
    return devices.map((d, i) => {
      const modelUse = h.perDeviceMiB[i] ?? 0;
      // Fracción del offset que le toca a este device (0 si el modelo no consume).
      const offsetShare = offset > 0 ? (modelUse / totalModel) * offset : 0;
      // Si el offset es negativo, lo descontamos del modelo (clampeado a ≥0).
      const used = offset < 0 ? Math.max(0, modelUse + (modelUse / totalModel) * offset) : modelUse + offsetShare;
      const base = countBaseline ? baseline[d.id] ?? 0 : 0;
      // % del modelo (+offset) sobre la VRAM TOTAL (no la libre: el modelo puede
      // usar VRAM que el display-server reporta como ocupada).
      const modelPct = d.totalMiB > 0 ? (used / d.totalMiB) * 100 : 0;
      const basePct = d.totalMiB > 0 ? (base / d.totalMiB) * 100 : 0;
      return {
        device: d,
        usedMiB: used,
        baselineMiB: base,
        pct: modelPct,
        totalPct: modelPct + basePct,
        // Desborda solo si (modelo + baseline) supera la VRAM total del device.
        overflow: used + base > d.totalMiB,
      };
    });
  });

  /**
   * Suma de la VRAM ya usada por los devices seleccionados (snapshot al abrir).
   * Solo cuenta cuando el switch "vram disponible" está activo.
   */
  protected readonly baselineUsedMiB = computed(() => {
    if (!this.countUsedVram()) return 0;
    const baseline = this.baselineUsedByDevice();
    return this.selectedDevices().reduce((s, d) => s + (baseline[d.id] ?? 0), 0);
  });

  /** Suma del consumo estimado (+ VRAM en uso previo). El offset de calibración
   * ya está incluido en bars().usedMiB (repartido por device), así que no se
   * suma aparte aquí para evitar doble conteo. */
  protected readonly totalUsedMiB = computed(() => {
    const modelUse = this.bars().reduce((s, b) => s + b.usedMiB, 0);
    return modelUse + this.baselineUsedMiB();
  });

  /** VRAM total (no libre) de los devices seleccionados. */
  protected readonly totalCapacityMiB = computed(() =>
    this.selectedDevices().reduce((s, d) => s + d.totalMiB, 0),
  );

  /**
   * % global usado vs la CAPACIDAD TOTAL de los devices (no la libre). El modelo
   * puede usar VRAM que el SO/display-server reporta como "ocupada", así que el
   * tope real es la VRAM total de la GPU, no el free del momento.
   */
  protected readonly totalPct = computed(() => {
    const cap = this.totalCapacityMiB();
    if (cap <= 0) return 0;
    return (this.totalUsedMiB() / cap) * 100;
  });

  /** True si la config excede la VRAM total de los devices. */
  protected readonly overflow = computed(() => this.totalUsedMiB() > this.totalCapacityMiB() && this.totalCapacityMiB() > 0);

  /** Tope del slider de ctx: límite físico del binario (--context-length). */
  protected readonly ctxMax = CTX_MAX;

  // ── Two-way binding del visible ──
  protected get visible(): boolean {
    return this.store.showOptimizer();
  }
  protected set visible(v: boolean) {
    if (!v) this.store.closeOptimizer();
  }

  constructor() {
    // Al abrir, cargar devices UNA vez. Importante: NO leer params() ni
    // loadingDevices dentro del effect (sería suscribirse y crear un loop:
    // el callback HTTP apaga loadingDevices → el effect se re-dispara → lo
    // vuelve a prender y dispara otro HTTP → loop infinito que congela el
    // navegador). Envolvemos loadDevices en untracked para que el effect
    // solo dependa de showOptimizer().
    effect(() => {
      if (this.store.showOptimizer()) {
        untracked(() => this.loadDevices());
      } else {
        this.seeded = false;
        this.offsetLoaded = false;
      }
    });
  }

  // ── Carga de devices (único HTTP al abrir) ──

  /**
   * Llama a /estimate del backend solo para obtener los devices (--list-devices)
   * y los metadatos del modelo parseado del script. La heurística del backend se
   * ignora: se recalcula client-side en `heuristic` (computed).
   *
   * Al abrir, los params se siembran desde el SCRIPT actual del editor (lo que el
   * usuario ya tiene configurado), no desde una recomendación.
   */
  protected loadDevices(): void {
    if (this.loadingDevices()) return;
    this.loadingDevices.set(true);
    this.loadError.set(null);
    const script = this.store.script();
    // Sembrar params desde el script UNA sola vez al abrir.
    if (!this.seeded) {
      this.params.set(parseParamsFromScript(script));
      this.seeded = true;
    }
    const params = untracked(this.params);
    this.api.estimate(script, params, 'ctx').subscribe({
      next: (resp) => {
        this.loadingDevices.set(false);
        if (resp.ok && resp.estimate) {
          this.devices.set(resp.estimate.devices);
          this.meta.set(resp.estimate.modelMeta);
          // Snapshot de la VRAM ya usada por device al abrir (total − free).
          // Se captura una sola vez: refleja lo ocupado por el display server,
          // otras apps u otro modelo, para restarlo de la disponible.
          const baseline: Record<string, number> = {};
          for (const d of resp.estimate.devices) {
            baseline[d.id] = Math.max(0, d.totalMiB - d.freeMiB);
          }
          this.baselineUsedByDevice.set(baseline);
          if (resp.estimate.devices.length === 0) {
            this.loadError.set('No se detectaron dispositivos. Revisá el binario en el script.');
          }
        } else {
          this.loadError.set(resp.error ?? 'No se pudo estimar.');
        }
      },
      error: (e: Error) => {
        this.loadingDevices.set(false);
        this.loadError.set(e.message);
      },
    });
    // Cargar el offset de calibración persistido (data/vram-offset.txt).
    // Es independiente del /estimate, va en paralelo y no afecta el loading.
    if (!this.offsetLoaded) {
      this.offsetLoaded = true;
      this.api.getVramOffset().subscribe({
        next: (raw) => {
          const n = parseInt(raw.trim(), 10);
          this.offsetMiB.set(Number.isFinite(n) ? n : 0);
        },
        error: () => {
          /* sin offset guardado → 0 (default) */
        },
      });
    }
  }

  // ── Acciones ──

  /**
   * Restablece TODOS los sliders y campos a los valores por defecto de
   * llama-server (--help). Útil para descartar ajustes manuales y volver al
   * baseline conocido del binario.
   */
  protected resetToDefaults(): void {
    this.params.set({
      ctxSize: 2048,
      ngl: 0,
      cacheTypeK: 'f16',
      cacheTypeV: 'f16',
      batchSize: 2048,
      ubatchSize: 512,
      flashAttn: true,
      device: [],
      tensorSplit: null,
      nCpuMoe: 0,
      cacheReuse: 0,
      noMmproj: false,
    });
    this.messages.add({ severity: 'info', summary: 'Valores por defecto aplicados', life: 2600 });
  }

  /** Aplica los params al script del editor y cierra. */
  protected applyToScript(): void {
    const next = applyTunedParams(this.store.script(), this.params());
    this.store.setScript(next);
    this.messages.add({ severity: 'success', summary: 'Parámetros aplicados al script', life: 2600 });
    this.store.closeOptimizer();
  }

  /** Recargar devices (p.ej. si cambió el binario en el script). */
  protected reloadDevices(): void {
    this.seeded = false;
    this.loadDevices();
  }

  // ── Handlers de inputs ──

  /**
   * Handler del slider de tensor-split de un device. Reconstruye el array completo
   * preservando las otras posiciones. Un valor de 0 saca ese device del reparto.
   */
  protected onTensorSplitSlider(deviceId: string, value: number): void {
    const items = this.tensorSplitItems();
    const next = items.map((it) => (it.device.id === deviceId ? value : it.value));
    const allZero = next.every((v) => v === 0);
    this.params.set({ ...this.params(), tensorSplit: allZero ? null : next });
  }

  /** Alterna tensor-split entre automático (null) y manual (uniforme 1:1). */
  protected toggleTensorSplitAuto(): void {
    if (this.tensorSplitAuto()) {
      const n = this.selectedDevices().length;
      this.params.set({ ...this.params(), tensorSplit: n > 0 ? new Array(n).fill(1) : null });
    } else {
      this.params.set({ ...this.params(), tensorSplit: null });
    }
  }

  // ── Offset de calibración (ajuste manual persistido) ──

  /**
   * Suma un delta (MiB) al offset de calibración y lo persiste en el backend.
   * Usado por los botones +500/−400/etc. del campo de calibración. El offset
   * puede ser negativo. Se guarda en data/vram-offset.txt para sobrevivir recargas.
   */
  protected adjustOffset(deltaMiB: number): void {
    const next = this.offsetMiB() + deltaMiB;
    this.offsetMiB.set(next);
    this.api.saveVramOffset(next).subscribe({
      error: () => this.messages.add({ severity: 'warn', summary: 'No se pudo guardar la calibración', life: 3000 }),
    });
  }

  /** Resetea el offset a 0 y lo persiste. */
  protected resetOffset(): void {
    this.offsetMiB.set(0);
    this.api.saveVramOffset(0).subscribe({ error: () => {} });
  }

  // ── Helpers de la barra de device (dos tonos: baseline + modelo) ──

  /** % del baseline clampeado a lo que cabe en la barra (≤100). */
  protected baselinePctClamped(b: DeviceBar): number {
    const basePct = b.totalPct - b.pct;
    return Math.max(0, Math.min(100, basePct));
  }

  /** % del modelo clampeado a lo que queda de la barra tras el baseline. */
  protected modelPctClamped(b: DeviceBar): number {
    const basePct = this.baselinePctClamped(b);
    const modelPct = Math.min(100, b.pct);
    // No exceder el 100% total entre ambos segmentos.
    return Math.max(0, Math.min(modelPct, 100 - basePct));
  }

  // ── Helpers de formato (exuestos al template) ──
  protected fmtGB = fmtGB;
  protected fmt = fmt;
  protected backendLabel = backendLabel;

  private defaultParams(): TunedParams {
    return {
      ctxSize: 8192,
      ngl: 999,
      cacheTypeK: 'q8_0',
      cacheTypeV: 'q8_0',
      batchSize: 512,
      ubatchSize: 128,
      flashAttn: true,
      device: [],
      tensorSplit: null,
      nCpuMoe: 0,
      cacheReuse: 0,
      noMmproj: false,
    };
  }
}

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
import { StorageService } from '../../core/services/storage.service';
import type { StoredCalibration } from '../../core/services/storage.service';
import { applyTunedParams, parseParamsFromScript } from '../../core/utils/flag-writer';
import {
  buildBreakdown,
  totalFreeFor,
  KV_TYPES,
} from '../../core/utils/vram-estimate';
import { fmtGB, fmt, backendLabel, isModelMoe } from '../../core/utils/format';
import type {
  DryfitResponse,
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
 * tensor-split (slider por device), --n-cpu-moe, --cache-reuse, --flash-attn,
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
  private readonly storage = inject(StorageService);

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

  // ── Calibración real (dry-fit) ──
  /** True mientras se ejecuta el dry-fit (arrancar el modelo + medir VRAM). */
  protected readonly calibrating = signal(false);
  /** Resultado de la medición real (null hasta que se calibra). */
  protected readonly measured = signal<DryfitResponse | null>(null);
  /**
   * Heurística (breakdown) del momento en que se calibró. Sirve de referencia
   * para que los sliders muevan las barras por delta respecto a la medición real:
   *   consumo = medido + (heurística_actual − heurística_al_calibrar)
   * Así, sin mover nada el consumo = medido; al subir ctx, el delta crece porque
   * la heurística modela el KV lineal. null si no hay calibración.
   */
  protected readonly heuristicAtCalib = signal<VramBreakdown | null>(null);
  /** Error de la calibración (OOM, modelo inválido…). null si todo ok. */
  protected readonly calibError = signal<string | null>(null);

  /**
   * Clave bajo la que se persiste la calibración en localStorage (el modelo).
   * Usa meta().raw (el -hf/--model) para que la medición se asocie al modelo y
   * se descarte automáticamente al cambiar de modelo. '' si aún no se cargó meta.
   */
  protected readonly modelKey = computed(() => this.meta()?.raw ?? '');

  /**
   * True si el modelo es identificable como MoE (Mixture of Experts) por su
   * nombre. El control --n-cpu-moe solo se muestra cuando aplica: en modelos
   * densos no tiene sentido offloadear expertos (no los hay).
   */
  protected readonly isMoe = computed(() => isModelMoe(this.meta()?.base));

  /** True cuando los params ya se sembraron al abrir (evita resembrar en reopen). */
  private seeded = false;

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

  /**
   * Bars por device. Sin calibración: valor heurístico. Con calibración: el valor
   * MEDIDO anclado + delta de la heurística desde el momento de calibrar:
   *   used = medido + (heurística_actual − heurística_al_calibrar)
   * Así, sin mover sliders el consumo = medido; al subir ctx (que escala el KV
   * lineal), el delta crece y la barra se mueve, manteniendo la precisión real.
   *
   * El baseline (VRAM en uso del display server) se suma siempre que el switch
   * "vram disponible" esté activo: computeDeviceVram mide solo el delta del
   * modelo, no el uso previo de la GPU.
   */
  protected readonly bars = computed<DeviceBar[]>(() => {
    const h = this.heuristic();
    const devices = this.selectedDevices();
    if (!h || devices.length === 0) return [];
    const countBaseline = this.countUsedVram();
    const baseline = this.baselineUsedByDevice();

    const measured = this.measured();
    const hAtCalib = this.heuristicAtCalib();
    const isCalibrated = measured != null && hAtCalib != null;
    // Mapa id → MiB medidos (para anclar cada device a su valor real).
    const measuredById = new Map<string, number>();
    if (measured) {
      for (const dv of measured.perDevice) {
        if (dv.usedMiB != null) measuredById.set(dv.device.id, dv.usedMiB);
      }
    }

    return devices.map((d, i) => {
      const heuristicNow = h.perDeviceMiB[i] ?? 0;
      let used: number;
      if (isCalibrated && measuredById.has(d.id)) {
        // Ancla: valor medido + delta de la heurística desde la calibración.
        const heuristicThen = hAtCalib.perDeviceMiB[i] ?? 0;
        used = Math.max(0, (measuredById.get(d.id) ?? 0) + (heuristicNow - heuristicThen));
      } else {
        used = heuristicNow;
      }
      const base = countBaseline ? baseline[d.id] ?? 0 : 0;
      const modelPct = d.totalMiB > 0 ? (used / d.totalMiB) * 100 : 0;
      const basePct = d.totalMiB > 0 ? (base / d.totalMiB) * 100 : 0;
      return {
        device: d,
        usedMiB: used,
        baselineMiB: base,
        pct: modelPct,
        totalPct: modelPct + basePct,
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

  /** Suma del consumo estimado (+ VRAM en uso previo si el switch está activo).
   * Cuando hay medición, bars().usedMiB ya viene del dry-fit (sin baseline, pues
   * computeDeviceVram mide solo el delta del modelo), así que se le suma el
   * baseline igual que al heurístico para reflejar la VRAM realmente ocupada. */
  protected readonly totalUsedMiB = computed(() => {
    const modelUse = this.bars().reduce((s, b) => s + b.usedMiB, 0);
    return modelUse + this.baselineUsedMiB();
  });

  /** VRAM total (no libre) de los devices seleccionados. */
  protected readonly totalCapacityMiB = computed(() =>
    this.selectedDevices().reduce((s, d) => s + d.totalMiB, 0),
  );

  /**
   * Consumo a mostrar en la barra grande: cuando hay medición, bars() ya refleja
   * el valor medido por device y totalUsedMiB() lo suma (+ baseline si el switch
   * está activo). Si no hay medición, es el heurístico. Así la barra grande y las
   * de por-device quedan consistentes entre sí.
   */
  protected readonly displayUsedMiB = computed(() => this.totalUsedMiB());

  /**
   * % global a mostrar vs la CAPACIDAD TOTAL de los devices (no la libre). El
   * modelo puede usar VRAM que el SO/display-server reporta como "ocupada", así
   * que el tope real es la VRAM total de la GPU, no el free del momento.
   */
  protected readonly displayPct = computed(() => {
    const cap = this.totalCapacityMiB();
    if (cap <= 0) return 0;
    return (this.displayUsedMiB() / cap) * 100;
  });

  /** True si la config excede la VRAM total de los devices. */
  protected readonly overflow = computed(
    () => this.displayUsedMiB() > this.totalCapacityMiB() && this.totalCapacityMiB() > 0,
  );

  /** Consumo del modelo según la heurística, SIN el baseline (solo modelo).
   * Se calcula directo del breakdown para no mezclar con la medición (bars()
   * cambia cuando hay medición). Sirve para comparar contra el valor medido. */
  protected readonly heuristicModelMiB = computed(() => {
    const h = this.heuristic();
    if (!h) return 0;
    return h.totalMiB;
  });

  /**
   * Diferencia entre lo medido y lo estimado (MiB). null si no hay medición.
   * Positivo = el real fue mayor que el estimado (la heurística subestimó).
   */
  protected readonly deltaMiB = computed(() => {
    const m = this.measured();
    if (!m || m.totalMiB == null) return null;
    return m.totalMiB - this.heuristicModelMiB();
  });

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
        // Al cerrar, limpiar los signals (la medición persiste en localStorage
        // keyed por modelo y se restaura al reabrir, si el modelo no cambió).
        this.measured.set(null);
        this.heuristicAtCalib.set(null);
        this.calibError.set(null);
        this.calibrating.set(false);
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
          // Restaurar la calibración persistida para este modelo (si la hay).
          // Se guarda keyed por meta.raw → se descarta al cambiar de modelo.
          // Incluye la heurística del momento de calibrar, para que los sliders
          // muevan las barras por delta sobre la medición real.
          const saved = this.storage.loadCalibration(resp.estimate.modelMeta.raw);
          this.measured.set(saved?.measured ?? null);
          this.heuristicAtCalib.set(saved?.heuristic ?? null);
          this.calibError.set(null);
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

  /** Recargar devices (p.ej. si cambió el binario o el modelo en el script). */
  protected reloadDevices(): void {
    this.seeded = false;
    // Limpia los signals; loadDevices restaurará la calibración del modelo actual
    // desde localStorage (si el modelo no cambió, es la misma; si cambió, otra o ninguna).
    this.measured.set(null);
    this.heuristicAtCalib.set(null);
    this.calibError.set(null);
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

  // ── Calibración real (dry-fit) ──

  /**
   * Arranca el modelo del script actual y mide la VRAM real consumida (sin
   * inferencia). El backend detiene el servidor al final siempre. Tarda lo que
   * tarda en cargar el modelo (puede ser 30s+ en modelos grandes).
   *
   * El resultado reemplaza al estimado en la barra principal. Se puede cancelar
   * con "Detener" (POST /benchmark/stop aborta el dry-fit, mismo controller).
   */
  protected calibrate(): void {
    if (this.calibrating()) return;
    this.calibrating.set(true);
    this.measured.set(null);
    this.heuristicAtCalib.set(null);
    this.calibError.set(null);
    const script = this.store.script();
    const key = this.modelKey();
    // Capturar la heurística actual (con los params del momento) como referencia:
    // los sliders moverán las barras por delta respecto a esta + la medición real.
    const hAtCalib = this.heuristic();
    this.api.dryfit(script).subscribe({
      next: (resp) => {
        if (resp.ok && resp.dryfit) {
          if (resp.dryfit.error) {
            this.calibError.set(resp.dryfit.error);
          } else {
            this.measured.set(resp.dryfit);
            this.heuristicAtCalib.set(hAtCalib);
            // Persistir medición + heurística de referencia keyed por modelo.
            if (key && hAtCalib) {
              const calibration: StoredCalibration = { measured: resp.dryfit, heuristic: hAtCalib };
              this.storage.saveCalibration(key, calibration);
            }
          }
        } else {
          this.calibError.set(resp.error ?? 'No se pudo calibrar.');
        }
      },
      error: (e: Error) => {
        this.calibError.set(e.message);
      },
      complete: () => this.calibrating.set(false),
    });
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

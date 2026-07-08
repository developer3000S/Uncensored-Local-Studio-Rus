import React, { memo, useEffect, useState, useCallback } from "react";
import {
  Crop, Sliders, Cpu, Info, MessageSquare, SlidersHorizontal, Zap,
  ChevronDown, Image, Type, Settings2, Gauge, Brain, Sparkles,
  Monitor, HardDrive, MemoryStick, Thermometer, Hash, Layers,
  ChevronRight, Box, Wand2, Lightbulb, RotateCcw, Check, Palette, Volume2,
  DownloadCloud, RefreshCw
} from "lucide-react";
import {
  stopServer,
  formatBytes,
  getLlmBackends,
  getLlmStats,
  getLlmStatus,
  benchmarkLlm,
  startLlm,
  stopLlm,
  downloadBackend,
  getDownloadProgress,
  getBackendOptions,
} from "../services/api";
import { THEMES } from "../themes";

const ASPECT_RATIOS = [
  { id: "1:1", label: "1:1 Square", width: 512, height: 512, sdxl_width: 1024, sdxl_height: 1024, desc: "Social posts & avatars" },
  { id: "4:3", label: "4:3 Photo", width: 640, height: 480, sdxl_width: 1152, sdxl_height: 864, desc: "Classic photo look" },
  { id: "16:9", label: "16:9 Landscape", width: 768, height: 432, sdxl_width: 1216, sdxl_height: 684, desc: "Widescreen landscape" },
  { id: "9:16", label: "9:16 Portrait", width: 432, height: 768, sdxl_width: 684, sdxl_height: 1216, desc: "Tall phone screen" }
];

const isSD15OrCustomModel = (modelName) => {
  if (!modelName) return true;
  const name = modelName.toLowerCase();
  if (name.includes("flux") || name.includes("schnell")) return false;
  if (name.includes("sdxl") || name.includes("lightning") || name.includes("turbo")) return false;
  if (name.includes("sd3")) return false;
  return true;
};

// ─── Collapsible Card Component ───
function CollapsibleCard({ icon: Icon, title, subtitle, children, defaultExpanded = false, id, badge, badgeColor }) {
  const [isExpanded, setIsExpanded] = useState(() => {
    const saved = localStorage.getItem(`settings_card_${id}`);
    return saved !== null ? saved === "true" : defaultExpanded;
  });

  const toggle = useCallback(() => {
    const newState = !isExpanded;
    setIsExpanded(newState);
    localStorage.setItem(`settings_card_${id}`, String(newState));
  }, [isExpanded, id]);

  return (
    <div className="collapsible-card">
      <button
        className="collapsible-header"
        onClick={toggle}
        aria-expanded={isExpanded}
        type="button"
      >
        <div className="collapsible-header-left">
          <div className="collapsible-header-icon">
            <Icon size={18} />
          </div>
          <div>
            <div className="collapsible-header-title">
              {title}
              {badge && (
                <span 
                  className="collapsible-header-badge" 
                  style={{ 
                    background: badgeColor || "var(--md-sys-color-primary-container)",
                    color: badgeColor ? "#fff" : "var(--md-sys-color-on-primary-container)"
                  }}
                >
                  {badge}
                </span>
              )}
            </div>
            {subtitle && <div className="collapsible-header-subtitle">{subtitle}</div>}
          </div>
        </div>
        <div className="collapsible-header-right">
          <ChevronDown
            size={20}
            className={`collapsible-chevron ${isExpanded ? "expanded" : ""}`}
          />
        </div>
      </button>
      {isExpanded && (
        <div className="collapsible-content">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Hardware Tier Badge Component ───
function HardwareTierBadge({ specs }) {
  if (!specs?.tier) return null;

  const tierConfig = {
    high: { icon: "🚀", label: "High-End PC", color: "tier-high", accent: "#22c55e" },
    mid: { icon: "⚖️", label: "Balanced PC", color: "tier-mid", accent: "#3b82f6" },
    low: { icon: "🥔", label: "Potato PC", color: "tier-low", accent: "#f59e0b" },
  };

  const tier = tierConfig[specs.tier] || tierConfig.low;
  const rec = specs.recommended_text_settings;

  return (
    <div className={`hardware-tier-badge ${tier.color}`}>
      <div className="hardware-tier-header">
        <div className="hardware-tier-icon">{tier.icon}</div>
        <div className="hardware-tier-info">
          <div className="hardware-tier-name">{tier.label}</div>
          <div className="hardware-tier-specs">
            {specs.cpu_name} • {specs.cpu_cores_physical} cores • {specs.ram_total_gb}GB RAM
            {specs.gpu_name && specs.gpu_name !== "Loading..." && ` • ${specs.gpu_name}`}
            {specs.gpu_vram_gb > 0 && ` • ${specs.gpu_vram_gb}GB VRAM`}
          </div>
        </div>
      </div>
      {rec && (
        <>
          <div className="hardware-tier-divider" />
          <div className="hardware-tier-chips">
            <span className="hardware-tier-chip">Ctx: {rec.contextSize}</span>
            <span className="hardware-tier-chip">Threads: {rec.threads}</span>
            <span className="hardware-tier-chip">KV: {rec.cacheTypeK}</span>
            <span className="hardware-tier-chip">Batch: {rec.batchSize}</span>
            <span className="hardware-tier-chip">Profile: {rec.performanceProfile}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Premium Toggle Component ───
function PremiumToggle({ checked, onChange, label, description }) {
  return (
    <label className="premium-toggle" style={{ cursor: "pointer" }}>
      <div
        className={`premium-toggle-checkbox ${checked ? "checked" : ""}`}
        onClick={() => onChange(!checked)}
        role="checkbox"
        aria-checked={checked}
      >
        {checked && <Check size={14} />}
      </div>
      <div style={{ flex: 1 }}>
        <div className="premium-toggle-label">{label}</div>
        {description && <div className="premium-toggle-desc">{description}</div>}
      </div>
    </label>
  );
}

// ─── Section Header Component ───
function SectionHeader({ icon: Icon, title, count, color, isExpanded, onToggle }) {
  return (
    <div
      className="settings-section-header"
      style={{
        borderLeftColor: color,
        cursor: "pointer",
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-expanded={isExpanded}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "14px", flex: 1 }}>
        <div className="settings-section-icon" style={{ background: color + "15", color }}>
          <Icon size={22} />
        </div>
        <div className="settings-section-title">{title}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {count && (
          <span className="settings-section-count">{count} settings</span>
        )}
        <ChevronDown
          size={20}
          style={{
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.3s var(--md-transition-easing)",
            color: isExpanded ? "var(--md-sys-color-primary)" : "var(--md-sys-color-outline)",
            flexShrink: 0
          }}
        />
      </div>
    </div>
  );
}

const getSliderStyle = (value, min, max) => {
  const v = Number(value);
  const mn = Number(min);
  const mx = Number(max);
  const pct = mx === mn ? 0 : ((v - mn) / (mx - mn)) * 100;
  return { "--value": `${pct}%` };
};

// ─── Main Settings Component ───
function Settings({
  constraints,
  setConstraints,
  activeModel,
  specs,
  backendOptions,
  setBackendOptions,
  serverRunning,
  setServerRunning,
  setActiveModel,
  textSettings,
  setTextSettings,
  speechSettings,
  setSpeechSettings,
  ttsSettings,
  setTtsSettings,
  showAlert = async ({ message }) => window.alert(message),
  showConfirm = async ({ message }) => window.confirm(message),
  health,
  cleanupItems,
  isReadinessBusy,
  refreshReadiness,
  copyDiagnostics,
  cleanupSafeItems,
  diagnosticsCopied,
  theme,
  setTheme,
  fontSize,
  setFontSize,
}) {
  const [llmStatus, setLlmStatus] = useState({ ready: false, settings: {} });
  const [llmBackends, setLlmBackends] = useState({ available: [], candidates: [] });
  const [llmStats, setLlmStats] = useState({ benchmarks: [] });
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [backendDownload, setBackendDownload] = useState({
    active: false,
    backendId: "",
    progress: 0,
    speed: "",
    error: null,
  });

  const [pendingTextSettings, setPendingTextSettings] = useState(textSettings || {});

  useEffect(() => {
    if (textSettings) {
      setPendingTextSettings(textSettings);
    }
  }, [textSettings]);

  const EDITABLE_TEXT_KEYS = [
    "systemPrompt", "contextSize", "temperature", "responseTokenMode", 
    "maxTokens", "seed", "performanceProfile", "threads", 
    "gpuLayers", "batchSize", "cacheTypeK", "cacheTypeV", "preferredBackend"
  ];

  const hasPendingChanges = textSettings && pendingTextSettings && EDITABLE_TEXT_KEYS.some(key => {
    return pendingTextSettings[key] !== textSettings[key];
  });

  const handleSaveTextSettings = async () => {
    try {
      setTextSettings(pendingTextSettings);
      if (llmStatus.ready) {
        await stopLlm();
        setLlmStatus((prev) => ({ ...prev, ready: false, running: false }));
        showAlert({
          title: "Settings Saved & Applied",
          message: "Text settings saved successfully. The running text model has been unloaded to apply these changes."
        });
      } else {
        showAlert({
          title: "Settings Saved",
          message: "Text settings saved successfully."
        });
      }
    } catch (err) {
      showAlert({
        title: "Save Failed",
        message: err.message || String(err),
        danger: true
      });
    }
  };

  const [expandedSections, setExpandedSections] = useState(() => {
    return {
      appearance: localStorage.getItem("settings_section_appearance") === "true",
      image: localStorage.getItem("settings_section_image") === "true",
      text: localStorage.getItem("settings_section_text") === "true",
      speech: localStorage.getItem("settings_section_speech") === "true",
      tts: localStorage.getItem("settings_section_tts") === "true",
    };
  });

  const toggleSection = (section) => {
    setExpandedSections((prev) => {
      const nextState = !prev[section];
      localStorage.setItem(`settings_section_${section}`, String(nextState));
      return { ...prev, [section]: nextState };
    });
  };

  useEffect(() => {
    let cancelled = false;
    const fetchLlmStatus = async () => {
      try {
        const status = await getLlmStatus();
        if (!cancelled) setLlmStatus(status);
      } catch (_) {}
      try {
        const [backends, stats] = await Promise.all([getLlmBackends(), getLlmStats()]);
        if (!cancelled) {
          setLlmBackends(backends);
          setLlmStats(stats);
        }
      } catch (_) {}
    };
    fetchLlmStatus();
    const interval = setInterval(fetchLlmStatus, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const isSD15OrCustom = activeModel ? isSD15OrCustomModel(activeModel) : false;
  const isOpenVinoNpu = constraints.backendType === "openvino-npu";
  const supportsThinking = Boolean(llmStatus.ready && llmStatus.settings?.supportsThinking);
  const availableBackends = backendOptions?.options?.length
    ? backendOptions.options
    : [{ id: "cpu", label: "CPU", available: true }];
  const unavailableBackends = Array.isArray(backendOptions?.unavailable)
    ? backendOptions.unavailable.filter((backend) => !availableBackends.some((available) => available.id === backend.id))
    : [];
  const visibleBackends = [...availableBackends, ...unavailableBackends.map((backend) => ({ ...backend, available: false }))];

  const refreshBackendOptions = useCallback(async () => {
    if (typeof setBackendOptions !== "function") return;
    const nextOptions = await getBackendOptions();
    setBackendOptions(nextOptions);
  }, [setBackendOptions]);

  useEffect(() => {
    refreshBackendOptions().catch(() => {});
    const handleFocus = () => refreshBackendOptions().catch(() => {});
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleFocus();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshBackendOptions]);

  useEffect(() => {
    if (!backendDownload.active) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const progress = await getDownloadProgress();
        if (cancelled) return;
        setBackendDownload((prev) => ({
          ...prev,
          active: Boolean(progress.active),
          progress: Number(progress.progress ?? prev.progress ?? 0),
          speed: progress.speed || prev.speed || "",
          error: progress.error || null,
        }));

        if (!progress.active && !progress.error) {
          await refreshBackendOptions();
        }
      } catch (err) {
        if (!cancelled) {
          setBackendDownload((prev) => ({
            ...prev,
            active: false,
            error: err.message || "Download failed",
          }));
        }
      }
    };

    poll();
    const interval = setInterval(poll, 700);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [backendDownload.active, refreshBackendOptions]);

  const updateConstraint = (key, value) => {
    setConstraints((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "steps"
        ? isOpenVinoNpu
          ? { npuSteps: value }
          : { standardSteps: value }
        : {}),
    }));
  };

  const updateTextSetting = (key, value) => {
    setPendingTextSettings((prev) => {
      const updated = { ...prev, [key]: value };
      
      // If the user selected a preset performance profile, apply its hardware parameters
      if (key === "performanceProfile") {
        const presets = specs?.recommended_text_settings;
        if (presets) {
          let preset = null;
          if (value === "potato") preset = presets.low;
          else if (value === "balanced") preset = presets.mid;
          else if (value === "high") preset = presets.high;
          
          if (preset) {
            Object.assign(updated, {
              contextSize: preset.contextSize,
              threads: preset.threads,
              gpuLayers: preset.gpuLayers,
              cacheTypeK: preset.cacheTypeK,
              cacheTypeV: preset.cacheTypeV,
              flashAttn: preset.flashAttn,
              mlock: preset.mlock,
              mmap: preset.mmap,
              cachePrompt: preset.cachePrompt,
              batchSize: preset.batchSize,
              ubatchSize: preset.ubatchSize,
            });
          }
        }
      } else {
        // If the user manually overrides any performance-related setting, auto-switch profile to "custom"
        const isPerformanceKey = [
          "contextSize", "threads", "gpuLayers", "cacheTypeK", "cacheTypeV",
          "flashAttn", "mlock", "mmap", "cachePrompt", "batchSize", "ubatchSize"
        ].includes(key);
        
        if (isPerformanceKey) {
          updated.performanceProfile = "custom";
        }
      }
      
      return updated;
    });
  };

  const updateSpeechSetting = (key, value) => {
    setSpeechSettings((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const updateTtsSetting = (key, value) => {
    setTtsSettings((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const buildTextStartOptions = (settings) => ({
    threads: settings?.threads || specs?.cpu_cores_physical || 4,
    contextSize: settings?.contextSize ?? 0,
    gpuLayers: settings?.gpuLayers ?? -1,
    enableThinking: settings?.enableThinking === true,
    flashAttn: settings?.flashAttn,
    cacheTypeK: settings?.cacheTypeK,
    cacheTypeV: settings?.cacheTypeV,
    mlock: settings?.mlock,
    mmap: settings?.mmap,
    cachePrompt: settings?.cachePrompt,
    defragThold: settings?.defragThold,
    batchSize: settings?.batchSize,
    ubatchSize: settings?.ubatchSize,
    performanceProfile: settings?.performanceProfile,
    preferredBackend: settings?.preferredBackend,
  });

  const handleBenchmarkTextBackend = async () => {
    const model = llmStatus.settings?.model;
    if (!model) {
      showAlert({ title: "No Text Model Loaded", message: "Load a GGUF text model before benchmarking.", danger: true });
      return;
    }
    setBenchmarkBusy(true);
    try {
      const result = await benchmarkLlm(model, {
        contextSize: Math.min(2048, Number(pendingTextSettings?.contextSize) || 2048),
        gpuLayers: pendingTextSettings?.gpuLayers ?? -1,
        includeCpu: true,
      });
      const winner = result.winner;
      showAlert({
        title: winner ? "Benchmark Complete" : "Benchmark Finished",
        message: winner
          ? `Fastest backend: ${winner.backendMode} at ${Number(winner.predicted_per_second || 0).toFixed(1)} tokens/sec.`
          : "Benchmark finished, but no backend returned usable timing data.",
      });
      const [status, backends, stats] = await Promise.all([getLlmStatus(), getLlmBackends(true), getLlmStats()]);
      setLlmStatus(status);
      setLlmBackends(backends);
      setLlmStats(stats);
    } catch (err) {
      showAlert({ title: "Benchmark Failed", message: err.message || String(err), danger: true });
    } finally {
      setBenchmarkBusy(false);
    }
  };

  const handleThinkingToggle = async (enabled) => {
    const nextSettings = { ...pendingTextSettings, enableThinking: enabled };

    let status = null;
    try {
      status = await getLlmStatus();
    } catch (_) {}
    if (!status?.ready || !status?.settings?.model) {
      setPendingTextSettings(nextSettings);
      setTextSettings(nextSettings);
      return;
    }

    const reload = await showConfirm({
      title: enabled ? "Reload With DeepThink?" : "Reload Without DeepThink?",
      message: "Changing DeepThink requires reloading the text model before it affects new replies. Reload now, or skip and keep the currently loaded model as-is?",
      confirmLabel: "Reload",
      cancelLabel: "Skip",
    });
    if (!reload) return;

    try {
      setPendingTextSettings(nextSettings);
      setTextSettings(nextSettings);
      await stopLlm();
      await startLlm(status.settings.model, buildTextStartOptions(nextSettings));
    } catch (err) {
      await showAlert({
        title: "Reload Failed",
        message: err.message || String(err),
        danger: true,
      });
    }
  };

  const handleAspectRatioChange = (ratio, sizeType) => {
    if (isOpenVinoNpu && ratio !== "1:1") return;
    const isSDXL = sizeType === "sdxl" && !isSD15OrCustom;
    const selected = ASPECT_RATIOS.find((r) => r.id === ratio);
    if (selected) {
      let w = isSDXL ? selected.sdxl_width : selected.width;
      let h = isSDXL ? selected.sdxl_height : selected.height;
      if (isOpenVinoNpu) {
        const size = constraints.width >= 1024 ? 1024 : 512;
        w = size;
        h = size;
      } else if (isSD15OrCustom) {
        if (w > h) {
          h = Math.round((h * 512) / w);
          w = 512;
        } else {
          w = Math.round((w * 512) / h);
          h = 512;
        }
        w = Math.round(w / 64) * 64;
        h = Math.round(h / 64) * 64;
      }
      updateConstraint("width", w);
      updateConstraint("height", h);
    }
  };

  const handleBackendChange = async (backendType) => {
    const currentBackend = constraints.backendType || "cpu";
    if (backendType === currentBackend) return;

    const switchesAccelerator =
      (currentBackend === "openvino-npu" && backendType !== "openvino-npu") ||
      (currentBackend !== "openvino-npu" && backendType === "openvino-npu");

    if (serverRunning && switchesAccelerator) {
      const leavingNpu = currentBackend === "openvino-npu";
      const confirmed = await showConfirm({
        title: leavingNpu ? "Unload NPU Model?" : "Unload Model?",
        message: leavingNpu
          ? "The OpenVINO NPU model must be unloaded before switching to the standard backend."
          : "The active model must be unloaded before switching to the OpenVINO NPU backend.",
        confirmLabel: "Unload",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!confirmed) return;

      try {
        await stopServer();
        setServerRunning(false);
        setActiveModel(null);
      } catch (err) {
        await showAlert({
          title: "Unload Failed",
          message: err.message || String(err),
          danger: true,
        });
        return;
      }
    }

    setConstraints((prev) => ({
      ...prev,
      backendType,
      useGpu: backendType !== "cpu",
      steps: backendType === "openvino-npu"
        ? Math.max(1, Math.min(8, prev.npuSteps || 4))
        : Math.max(1, Math.min(60, prev.standardSteps || 20)),
      ...(backendType === "openvino-npu"
        ? {
            width: prev.width >= 1024 ? 1024 : 512,
            height: prev.width >= 1024 ? 1024 : 512,
          }
        : {}),
    }));
  };

  const handleBackendDownload = async (backend) => {
    if (!backend?.id || backendDownload.active) return;
    try {
      setBackendDownload({
        active: true,
        backendId: backend.id,
        progress: 0,
        speed: "Starting",
        error: null,
      });
      await downloadBackend(backend.id);
    } catch (err) {
      setBackendDownload({
        active: false,
        backendId: backend.id,
        progress: 0,
        speed: "",
        error: err.message || "Download failed",
      });
      await showAlert({
        title: "Backend Download Failed",
        message: err.message || "Could not start backend download.",
        danger: true,
      });
    }
  };

  // ─── Image Settings ───
  const renderImageSettings = () => (
    <>
      <SectionHeader 
        icon={Image} 
        title="Генерация изображения" 
        count={4}
        color="#3b82f6"
        isExpanded={expandedSections.image}
        onToggle={() => toggleSection("image")}
      />
      
      {expandedSections.image && (
        <div className="settings-expanded-content">
          <div className="settings-two-column">
        {/* Left Column */}
        <div className="settings-column">
          {/* Size & Shape */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Crop size={16} />
              Размер и форма
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Разрешение</span>
                  <span className="settings-value-badge">
                    {constraints.width >= 1024 ? "SDXL" : "SD 1.5"}
                  </span>
                </div>
                <div className="m3-segmented-button">
                  {["sd15", "sdxl"].map((mode) => (
                    <button
                      key={mode}
                      className={`m3-segment-item ${(constraints.width >= 1024 ? "sdxl" : "sd15") === mode ? "active" : ""}`}
                      onClick={() => {
                        const ratio = ASPECT_RATIOS.find(r => {
                          const rw = constraints.width >= 1024 ? r.sdxl_width : r.width;
                          const rh = constraints.height >= 1024 ? r.sdxl_height : r.height;
                          return Math.abs(rw - constraints.width) < 10 && Math.abs(rh - constraints.height) < 10;
                        })?.id || "1:1";
                        handleAspectRatioChange(ratio, mode);
                      }}
                      disabled={isSD15OrCustom && mode === "sdxl"}
                    >
                      {mode === "sd15" ? "512px" : "1024px"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Соотношение сторон</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                  {ASPECT_RATIOS.map((ratio) => {
                    const isSDXL = constraints.width >= 1024 && !isSD15OrCustom;
                    const rw = isSDXL ? ratio.sdxl_width : ratio.width;
                    const rh = isSDXL ? ratio.sdxl_height : ratio.height;
                    const isActive = Math.abs(constraints.width - rw) < 10 && Math.abs(constraints.height - rh) < 10;
                    return (
                      <button
                        key={ratio.id}
                        className={`m3-btn ${isActive ? "m3-btn-filled" : "m3-btn-outlined"}`}
                        onClick={() => handleAspectRatioChange(ratio.id, isSDXL ? "sdxl" : "sd15")}
                        disabled={isOpenVinoNpu && ratio.id !== "1:1"}
                        style={{ fontSize: "0.8rem", padding: "10px 4px", height: "auto" }}
                      >
                        <div style={{ fontWeight: 700 }}>{ratio.id}</div>
                        <div style={{ fontSize: "0.7rem", opacity: 0.8, marginTop: "2px" }}>
                          {rw}×{rh}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div className="m3-text-field">
                  <label className="m3-text-field-label">Ширина</label>
                  <input
                    type="number"
                    className="m3-input"
                    value={constraints.width}
                    onChange={(e) => updateConstraint("width", Math.round(parseInt(e.target.value) / 64) * 64)}
                    min="64"
                    max="2048"
                    step="64"
                  />
                </div>
                <div className="m3-text-field">
                  <label className="m3-text-field-label">Высота</label>
                  <input
                    type="number"
                    className="m3-input"
                    value={constraints.height}
                    onChange={(e) => updateConstraint("height", Math.round(parseInt(e.target.value) / 64) * 64)}
                    min="64"
                    max="2048"
                    step="64"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Quality & Speed */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Sliders size={16} />
              Качество и скорость
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Шаги детализации</span>
                  <span className="settings-value-badge">{constraints.steps}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={constraints.steps}
                  onChange={(e) => updateConstraint("steps", parseInt(e.target.value))}
                  min="1"
                  max={isOpenVinoNpu ? "8" : "60"}
                  style={getSliderStyle(constraints.steps, 1, isOpenVinoNpu ? 8 : 60)}
                />
                <span className="settings-option-desc">
                  {isOpenVinoNpu
                    ? "LCM OpenVINO: 1-8 быстрых шагов"
                    : "Больше шагов = более четкие детали, больше времени"}
                </span>
              </div>

              <div className="m3-text-field">
                <label className="m3-text-field-label">Параметр Random Seed</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="number"
                    className="m3-input"
                    value={constraints.seed}
                    onChange={(e) => updateConstraint("seed", parseInt(e.target.value) || -1)}
                    placeholder="-1 для случайного"
                    style={{ flex: 1 }}
                  />
                  <button
                    className="m3-btn m3-btn-tonal"
                    onClick={() => updateConstraint("seed", -1)}
                  >
                    Случайный
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="settings-column">
          {/* Memory Optimizations */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <SlidersHorizontal size={16} />
              Оптимизация памяти
            </div>
            <div className="m3-field-group">
              <PremiumToggle
                checked={constraints.vaeTiling}
                onChange={(v) => updateConstraint("vaeTiling", v)}
                label="Плиточное VAE"
                description="Обрабатывает изображение по плитам, чтобы сэкономить VRAM"
              />
              <PremiumToggle
                checked={constraints.vaeOnCpu}
                onChange={(v) => updateConstraint("vaeOnCpu", v)}
                label="VAE на CPU"
                description="Запуск декодера на CPU при недостатке памяти GPU"
              />
              <PremiumToggle
                checked={constraints.useFlashAttn}
                onChange={(v) => updateConstraint("useFlashAttn", v)}
                label="Flash Attention"
                description="Более быстрая работа внимания с меньшим потреблением памяти"
              />
            </div>
          </div>

          {/* Backend & Acceleration */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Monitor size={16} />
              Бэкенд и ускорение
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Акселератор</span>
                </div>
                <div className="m3-segmented-button" style={{ flexWrap: "wrap" }}>
                  {visibleBackends.map((b) => {
                    const isAvailable = b.available !== false;
                    const isDownloading = backendDownload.active && backendDownload.backendId === b.id;
                    return (
                    <button
                      key={b.id}
                      className={`m3-segment-item ${constraints.backendType === b.id ? "active" : ""} ${!isAvailable ? "disabled" : ""}`}
                      onClick={() => isAvailable && handleBackendChange(b.id)}
                      disabled={!isAvailable}
                      title={!isAvailable ? b.reason : undefined}
                      style={{ flex: "1 1 auto", minWidth: "80px" }}
                    >
                      {isDownloading ? `${Math.max(0, Math.min(100, Math.round(backendDownload.progress)))}%` : b.label}
                    </button>
                    );
                  })}
                </div>
                {unavailableBackends.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                    {unavailableBackends.map((backend) => {
                      const isDownloading = backendDownload.active && backendDownload.backendId === backend.id;
                      const progress = Math.max(0, Math.min(100, Math.round(backendDownload.progress || 0)));
                      return (
                        <div
                          key={`download-${backend.id}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "10px",
                            padding: "10px",
                            border: "1px solid var(--md-sys-color-outline-variant)",
                            borderRadius: "8px",
                            background: "var(--md-sys-color-surface-container-low)",
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, color: "var(--md-sys-color-on-surface)" }}>
                              {backend.label}
                            </div>
                            <div className="settings-option-desc" title={backendDownload.error || backend.reason}>
                              {isDownloading
                                ? `${progress}% ${backendDownload.speed ? `- ${backendDownload.speed}` : ""}`
                                : backendDownload.error && backendDownload.backendId === backend.id
                                  ? backendDownload.error
                                  : backend.reason}
                            </div>
                            {isDownloading && (
                              <div className="model-progress-bar" style={{ marginTop: "6px" }}>
                                <div
                                  className="model-progress-fill"
                                  style={{
                                    width: `${progress}%`,
                                    transition: "width 0.2s ease",
                                  }}
                                />
                              </div>
                            )}
                          </div>
                          <button
                            className="m3-btn m3-btn-tonal"
                            onClick={() => handleBackendDownload(backend)}
                            disabled={backendDownload.active}
                            style={{ flexShrink: 0 }}
                          >
                            {isDownloading ? <RefreshCw className="progress-spinner" size={14} /> : <DownloadCloud size={14} />}
                            <span>{isDownloading ? "Загрузка" : "Скачать"}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
          </div>
        </div>
      )}
    </>
  );

  // ─── Text Settings ───
  const renderTextSettings = () => (
    <>
      <SectionHeader 
        icon={Type} 
        title="Генерация текста" 
        count={5}
        color="#8b5cf6"
        isExpanded={expandedSections.text}
        onToggle={() => toggleSection("text")}
      />
      
      {expandedSections.text && (
        <div className="settings-expanded-content">
          <div className="settings-two-column">
        {/* Left Column */}
        <div className="settings-column">
          {/* Model & Context */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <MessageSquare size={16} />
              Модель и контекст
            </div>
            <div className="m3-field-group">
              <div className="m3-text-field">
                <label className="m3-text-field-label">Системный промпт</label>
                <textarea
                   className="m3-input"
                   value={pendingTextSettings.systemPrompt || ""}
                   onChange={(e) => updateTextSetting("systemPrompt", e.target.value)}
                   placeholder="Введите системный промпт..."
                   rows={3}
                   style={{ resize: "vertical", minHeight: "60px" }}
                />
                <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                  Определяет личность/инструкции ассистента. (Рекомендуется: По умолчанию)
                </span>
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Размер контекста</span>
                  <span className="settings-value-badge">{pendingTextSettings.contextSize || 0}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.contextSize || 0}
                  onChange={(e) => updateTextSetting("contextSize", parseInt(e.target.value))}
                  min="0"
                  max="32768"
                  step="512"
                  style={getSliderStyle(pendingTextSettings.contextSize || 0, 0, 32768)}
                />
                <span className="settings-option-desc">
                  Ограничение памяти модели. 0 использует значение по умолчанию. (Рекомендуется: 0)
                </span>
              </div>
            </div>
          </div>

          {/* Generation Parameters */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Settings2 size={16} />
              Параметры генерации
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Температура</span>
                  <span className="settings-value-badge">{pendingTextSettings.temperature}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.temperature}
                  onChange={(e) => updateTextSetting("temperature", parseFloat(e.target.value))}
                  min="0"
                  max="2"
                  step="0.1"
                  style={getSliderStyle(pendingTextSettings.temperature, 0, 2)}
                />
                <span className="settings-option-desc">
                  Контролирует креативность. Меньше = точнее и фактическое, Больше = креативнее и разнообразнее. (Рекомендуется: 0.7)
                </span>
              </div>


              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Максимум токенов ответа</span>
                  <span className="settings-value-badge">
                    {(pendingTextSettings.responseTokenMode || "auto") === "auto" ? "Авто" : (pendingTextSettings.maxTokens || 1024)}
                  </span>
                </div>
                <div className="m3-segmented-button" style={{ marginBottom: "10px" }}>
                  {[
                    { id: "auto", label: "Авто" },
                    { id: "manual", label: "Ручной" },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      className={`m3-segment-item ${(pendingTextSettings.responseTokenMode || "auto") === mode.id ? "active" : ""}`}
                      onClick={() => updateTextSetting("responseTokenMode", mode.id)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                {(pendingTextSettings.responseTokenMode || "auto") === "manual" ? (
                  <>
                    <input
                      type="range"
                      className="m3-slider"
                      value={pendingTextSettings.maxTokens || 1024}
                      onChange={(e) => updateTextSetting("maxTokens", parseInt(e.target.value))}
                      min="64"
                      max="4096"
                      step="64"
                      style={getSliderStyle(pendingTextSettings.maxTokens || 1024, 64, 4096)}
                    />
                    <span className="settings-option-desc">
                      Ручной режим использует значение с ползунка.
                    </span>
                  </>
                ) : (
                  <span className="settings-option-desc">
                    Авто автоматически настраивает длину на основе окна контекста. (Рекомендуется)
                  </span>
                )}
              </div>

              <div className="m3-text-field">
                <label className="m3-text-field-label">Сид</label>
                <input
                  type="number"
                  className="m3-input"
                  value={pendingTextSettings.seed}
                  onChange={(e) => updateTextSetting("seed", parseInt(e.target.value) || -1)}
                  placeholder="-1"
                />
                <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                  Контролирует повторяемость. Используйте -1 для случайного, положительное целое для одинаковых ответов. (Рекомендуется: -1)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="settings-column">
          {/* Performance Profile */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Gauge size={16} />
              Профиль производительности
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Профиль</span>
                </div>
                <div className="m3-segmented-button">
                  {["potato", "balanced", "high", "custom"].map((profile) => {
                    const profileLabels = {
                      potato: "Низкий",
                      balanced: "Сбалансированный",
                      high: "Высокий",
                      custom: "Пользовательский",
                    };
                    return (
                      <button
                        key={profile}
                        className={`m3-segment-item ${(pendingTextSettings.performanceProfile || "balanced") === profile ? "active" : ""}`}
                        onClick={() => updateTextSetting("performanceProfile", profile)}
                      >
                        {profileLabels[profile]}
                      </button>
                    );
                  })}
                </div>
              </div>



              {llmBackends.available?.length > 1 && (
                <div className="m3-slider-group">
                  <div className="m3-slider-header">
                    <span className="m3-slider-label">Текстовый бэкенд</span>
                  </div>
                  <div className="m3-segmented-button">
                    {llmBackends.available.map((backend) => (
                      <button
                        key={backend.key}
                        className={`m3-segment-item ${(pendingTextSettings.preferredBackend || "auto") === backend.key ? "active" : ""}`}
                        onClick={() => updateTextSetting("preferredBackend", backend.key)}
                      >
                        {backend.key === "cpu" ? "Только CPU" : backend.key.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Потоки CPU</span>
                  <span className="settings-value-badge">{pendingTextSettings.threads || 4}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.threads || 4}
                  onChange={(e) => updateTextSetting("threads", parseInt(e.target.value))}
                  min="1"
                  max={specs?.cpu_cores_logical || 16}
                  style={getSliderStyle(pendingTextSettings.threads || 4, 1, specs?.cpu_cores_logical || 16)}
                />
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Слои GPU</span>
                  <span className="settings-value-badge">{pendingTextSettings.gpuLayers === -1 ? "Все" : pendingTextSettings.gpuLayers}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.gpuLayers === -1 ? 50 : pendingTextSettings.gpuLayers}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    updateTextSetting("gpuLayers", val >= 50 ? -1 : val);
                  }}
                  min="0"
                  max="50"
                  style={getSliderStyle(pendingTextSettings.gpuLayers === -1 ? 50 : pendingTextSettings.gpuLayers, 0, 50)}
                />
                <span className="settings-option-desc">
                  50 = Все слои на GPU
                </span>
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Размер батча</span>
                  <span className="settings-value-badge">{pendingTextSettings.batchSize || 512}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.batchSize || 512}
                  onChange={(e) => updateTextSetting("batchSize", parseInt(e.target.value))}
                  min="64"
                  max="2048"
                  step="64"
                  style={getSliderStyle(pendingTextSettings.batchSize || 512, 64, 2048)}
                />
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">KV кэш</span>
                </div>
                <div className="m3-segmented-button">
                  {["q4_0", "q8_0", "f16"].map((type) => (
                    <button
                      key={type}
                      className={`m3-segment-item ${(pendingTextSettings.cacheTypeK || "q8_0") === type ? "active" : ""}`}
                      onClick={() => {
                        updateTextSetting("cacheTypeK", type);
                        updateTextSetting("cacheTypeV", type);
                      }}
                    >
                      {type.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {hasPendingChanges && (
                <div className="settings-save-bar" style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px 20px",
                  background: "color-mix(in srgb, var(--md-sys-color-primary) 10%, var(--bg-card))",
                  border: "1px solid color-mix(in srgb, var(--md-sys-color-primary) 30%, transparent)",
                  borderRadius: "14px",
                  marginTop: "20px",
                  gap: "16px",
                  flexWrap: "wrap",
                  animation: "fadeIn 0.2s ease",
                  width: "100%",
                  boxSizing: "border-box"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <Brain size={18} style={{ color: "var(--md-sys-color-primary)" }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Несохранённые настройки генерации текста</div>
                      <div style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: "2px" }}>
                        {llmStatus.ready
                          ? "Сохранение выгрузит активную текстовую модель, чтобы применить изменения."
                          : "Изменения будут применены при следующей загрузке модели."}
                      </div>
                    </div>
                  </div>
                  <button
                    className="m3-btn m3-btn-filled"
                    onClick={handleSaveTextSettings}
                    style={{
                      background: "var(--md-sys-color-primary)",
                      color: "var(--md-sys-color-on-primary)",
                      border: "none",
                      borderRadius: "10px",
                      padding: "10px 18px",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      boxShadow: "0 2px 8px color-mix(in srgb, var(--md-sys-color-primary) 30%, transparent)",
                    }}
                  >
                    Сохранить и применить
                  </button>
                </div>
              )}
            </div>
          </div>


        </div>
          </div>
        </div>
      )}
    </>
  );

  // ─── Speech Settings ───
  const renderSpeechSettings = () => {
    const SPEECH_LANGUAGES = [
      { value: "auto", label: "Авто определение" },
      { value: "en", label: "Английский" },
      { value: "es", label: "Испанский" },
      { value: "fr", label: "Французский" },
      { value: "de", label: "Немецкий" },
      { value: "it", label: "Итальянский" },
      { value: "pt", label: "Португальский" },
      { value: "hi", label: "Хинди" },
      { value: "ja", label: "Японский" },
      { value: "ko", label: "Корейский" },
      { value: "zh", label: "Китайский" },
    ];

    return (
      <>
        <SectionHeader 
          icon={Volume2} 
          title="Транскрибирование речи" 
          count={4}
          color="#10b981"
          isExpanded={expandedSections.speech}
          onToggle={() => toggleSection("speech")}
        />
        
        {expandedSections.speech && (
          <div className="settings-expanded-content">
            <div className="settings-two-column">
              {/* Left Column */}
              <div className="settings-column">
                {/* Speech Parameters */}
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Volume2 size={16} />
                    Настройки транскрипции
                  </div>
                  <div className="m3-field-group">
                    <div className="m3-text-field">
                      <label className="m3-text-field-label">Бэкенд по умолчанию</label>
                      <select
                        className="m3-input"
                        value={speechSettings.backendPreference || "auto"}
                        onChange={(e) => updateSpeechSetting("backendPreference", e.target.value)}
                      >
                        <option value="auto">Авто - GPU если установлен</option>
                        <option value="vulkan">Vulkan GPU</option>
                        <option value="metal">Metal GPU</option>
                        <option value="cpu">CPU</option>
                      </select>
                      <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                        Авто использует GPU бэкенд whisper.cpp, если его бинарник найден, затем переключается на CPU.
                      </span>
                    </div>

                    <div className="m3-text-field">
                      <label className="m3-text-field-label">Язык по умолчанию</label>
                      <select 
                        className="m3-input" 
                        value={speechSettings.language || "auto"} 
                        onChange={(e) => updateSpeechSetting("language", e.target.value)}
                      >
                        {SPEECH_LANGUAGES.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                        Язык по умолчанию для расшифровки аудио. (Рекомендуется: Авто)
                      </span>
                    </div>

                    <div className="m3-slider-group">
                      <div className="m3-slider-header">
                        <span className="m3-slider-label">Потоки CPU</span>
                        <span className="settings-value-badge">{speechSettings.threads || 4}</span>
                      </div>
                      <input
                        type="range"
                        className="m3-slider"
                        value={speechSettings.threads || 4}
                        onChange={(e) => updateSpeechSetting("threads", parseInt(e.target.value))}
                        min="1"
                        max={specs?.cpu_cores_logical || 16}
                        style={getSliderStyle(speechSettings.threads || 4, 1, specs?.cpu_cores_logical || 16)}
                      />
                      <span className="settings-option-desc">
                        Количество потоков для расшифровки. (Рекомендуется: 4)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="settings-column">
                {/* Translation options */}
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Sparkles size={16} />
                    Настройки перевода
                  </div>
                  <div className="m3-field-group">
                    <PremiumToggle
                      checked={speechSettings.translate === true}
                      onChange={(val) => updateSpeechSetting("translate", val)}
                      label="Перевод на английский"
                      description="Автоматически переводить иностранные языки на английский во время расшифровки"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  // ─── Appearance Settings ───
  const renderTtsSettings = () => {
    const TTS_VOICES = [
      { value: "af_heart", label: "Heart - Female, US English" },
      { value: "af_bella", label: "Bella - Female, US English" },
      { value: "af_nicole", label: "Nicole - Female, US English" },
      { value: "af_sarah", label: "Sarah - Female, US English" },
      { value: "am_michael", label: "Michael - Male, US English" },
      { value: "am_fenrir", label: "Fenrir - Male, US English" },
      { value: "bf_emma", label: "Emma - Female, UK English" },
      { value: "bm_george", label: "George - Male, UK English" },
    ];

    return (
      <>
        <SectionHeader
          icon={Volume2}
          title="Текст в речь"
          count={2}
          color="#8b5cf6"
          isExpanded={expandedSections.tts}
          onToggle={() => toggleSection("tts")}
        />

        {expandedSections.tts && (
          <div className="settings-expanded-content">
            <div className="settings-two-column">
              <div className="settings-column">
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Volume2 size={16} />
                    Голос по умолчанию
                  </div>
                  <div className="m3-field-group">
                    <div className="m3-text-field">
                      <label className="m3-text-field-label">Голос по умолчанию</label>
                      <select
                        className="m3-input"
                        value={ttsSettings?.voice || "af_heart"}
                        onChange={(e) => updateTtsSetting("voice", e.target.value)}
                      >
                        {TTS_VOICES.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                        Голос Kokoro по умолчанию для сгенерированных WAV-файлов.
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-column">
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Gauge size={16} />
                    Параметры речи
                  </div>
                  <div className="m3-slider-group">
                    <div className="m3-slider-header">
                      <span className="m3-slider-label">Скорость</span>
                      <span className="settings-value-badge">{(ttsSettings?.speed || 1).toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      className="m3-slider"
                      value={ttsSettings?.speed || 1}
                      onChange={(e) => updateTtsSetting("speed", parseFloat(e.target.value))}
                      min="0.5"
                      max="2"
                      step="0.05"
                      style={getSliderStyle(ttsSettings?.speed || 1, 0.5, 2)}
                    />
                    <span className="settings-option-desc">
                      1.00x — естественная скорость. Меньше = медленнее, больше = быстрее.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  const renderAppearanceSettings = () => (
    <>
      <SectionHeader 
        icon={Palette} 
        title="Внешний вид и темы" 
        count={2}
        color="var(--md-sys-color-primary)"
        isExpanded={expandedSections.appearance}
        onToggle={() => toggleSection("appearance")}
      />
      
      {expandedSections.appearance && (
        <div className="settings-expanded-content">
          <div className="settings-subsection">
            {/* Color Themes Sub-section */}
            <div className="settings-subsection-title">
              <Palette size={16} />
              Тематические цвета
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: "14px",
              marginTop: "14px"
            }}>
              {THEMES.map((t) => {
                const isActive = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`theme-card-btn ${isActive ? "active" : ""}`}
                    style={{
                      background: t.bg,
                      color: t.type === "dark" ? "#f4f4f5" : "#0f172a",
                      border: isActive ? "2px solid var(--md-sys-color-primary)" : "1px solid var(--border-color)",
                      borderRadius: "14px",
                      padding: "18px",
                      textAlign: "left",
                      cursor: "pointer",
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      gap: "14px",
                      boxShadow: isActive ? "0 4px 16px color-mix(in srgb, var(--md-sys-color-primary) 25%, transparent)" : "none",
                      transition: "all 0.25s ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.88rem", letterSpacing: "-0.01em" }}>{t.name}</span>
                      {isActive && (
                        <div style={{
                          background: "linear-gradient(135deg, var(--md-sys-color-primary), var(--md-sys-color-secondary))",
                          color: "var(--md-sys-color-on-primary)",
                          borderRadius: "50%",
                          width: "22px",
                          height: "22px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 2px 6px color-mix(in srgb, var(--md-sys-color-primary) 40%, transparent)"
                        }}>
                          <Check size={13} strokeWidth={3} />
                        </div>
                      )}
                    </div>
                    
                    {/* Preview circles for primary and secondary colors */}
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: t.primary, border: "2px solid rgba(255,255,255,0.25)", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }} title="Основной цвет" />
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: t.secondary, border: "2px solid rgba(255,255,255,0.25)", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }} title="Дополнительный цвет" />
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: t.bg, border: "1.5px solid rgba(0,0,0,0.12)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.06)" }} title="Фон" />
                      <span style={{ marginLeft: "auto", fontSize: "0.7rem", opacity: 0.6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {t.type}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Divider separating sub-sections inside the single card */}
            <div style={{
              height: "1px",
              background: "var(--border-color)",
              margin: "24px 0"
            }} />

            {/* Text & Interface Size Sub-section */}
            <div className="settings-subsection-title">
              <Type size={16} />
              Размер текста и интерфейса
            </div>
            <div className="m3-slider-group" style={{ maxWidth: "480px", marginTop: "14px" }}>
              <div className="m3-slider-header">
                <span className="m3-slider-label">Размер шрифта</span>
                <span className="settings-value-badge">{fontSize || 16}px</span>
              </div>
              <input
                type="range"
                className="m3-slider"
                value={fontSize || 16}
                onChange={(e) => setFontSize(parseInt(e.target.value))}
                min="12"
                max="24"
                step="1"
                style={getSliderStyle(fontSize || 16, 12, 24)}
              />
              <span className="settings-option-desc">
                Настраивает глобальный размер шрифта приложения, включая ответы чата и подписи настроек. По умолчанию 16px.
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="workspace-area">
      {/* Page Header */}
      <div className="workspace-title-section">
        <h2 className="workspace-title">Настройки и параметры</h2>
        <p className="workspace-subtitle">
          Настройте ИИ модели для оптимальной работы.
        </p>
      </div>


      {/* Appearance & Themes Section */}
      {renderAppearanceSettings()}

      {/* Image Settings Section */}
      {renderImageSettings()}

      {/* Text Settings Section */}
      {renderTextSettings()}

      {/* Speech Settings Section */}
      {renderSpeechSettings()}

      {/* Text to Speech Settings Section */}
      {renderTtsSettings()}
    </div>
  );
}

export default memo(Settings);

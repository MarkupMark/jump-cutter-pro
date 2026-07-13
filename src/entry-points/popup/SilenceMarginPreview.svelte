<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let marginBefore: number;
  export let marginAfter: number;
  export let silenceSpeed: number;
  export let title: string;
  export let beforeLabel: string;
  export let afterLabel: string;
  export let silenceLabel: string;
  export let minBefore: number;
  export let maxBefore: number;
  export let stepBefore: number;
  export let minAfter: number;
  export let maxAfter: number;
  export let stepAfter: number;
  export let disabled: boolean = false;

  const dispatch = createEventDispatcher<{ inputBefore: void, inputAfter: void }>();
  const silenceStart = 38;
  const silenceEnd = 62;
  const marginWidth = (silenceEnd - silenceStart) / 2;
  const zoomStart = 4;
  const zoomEnd = 96;
  const zoomWidth = zoomEnd - zoomStart;

  function ratio(value: number, min: number, max: number) {
    if (max <= min) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }

  $: beforeRatio = ratio(marginBefore, minBefore, maxBefore);
  $: afterRatio = ratio(marginAfter, minAfter, maxAfter);
  $: beforeWidth = beforeRatio * marginWidth;
  $: afterWidth = afterRatio * marginWidth;
  $: afterStart = silenceEnd - afterWidth;
  $: speedStart = silenceStart + beforeWidth;
  $: speedWidth = Math.max(0, afterStart - speedStart);
  $: speedBadgeCenter = speedStart + speedWidth / 2;
  $: detailSpeedStart = zoomStart + beforeRatio * zoomWidth / 2;
  $: detailSpeedWidth = Math.max(0, zoomWidth - (beforeRatio + afterRatio) * zoomWidth / 2);
  $: detailBadgeCenter = detailSpeedStart + detailSpeedWidth / 2;
  $: speedLabel = Number.isFinite(silenceSpeed)
    ? `${Number(silenceSpeed.toFixed(2))}×`
    : '∞×';
  $: badgeWidth = Math.max(15.5, 8.5 + speedLabel.length * 1.6);
</script>

<section class="preview" aria-label={title}>
  <strong>{title}</strong>

  <svg class="overview" viewBox="0 0 100 34" role="img" aria-label={`${beforeLabel}: ${Math.round(marginBefore * 1000)} ms, ${afterLabel}: ${Math.round(marginAfter * 1000)} ms, ${speedLabel}`}>
    <rect class="silence" x={silenceStart} y="3" width={silenceEnd - silenceStart} height="25" rx="2" />
    <rect class="speed-zone" x={speedStart} y="3" width={speedWidth} height="25" rx="2" />
    <line class="threshold" x1="2" y1="17" x2="98" y2="17" />
    <path class="wave" d="M2 22 L8 22 L11 12 L14 27 L17 7 L20 25 L23 10 L26 22 L30 22 L33 14 L36 24 L38 22 L43 22 L46 20 L49 23 L52 21 L55 22 L62 22 L64 24 L67 9 L70 27 L73 6 L76 25 L79 11 L82 22 L88 22 L91 15 L94 24 L98 22" />
    {#if speedWidth >= 11}
      <g class="speed-badge">
        <rect x={speedBadgeCenter - badgeWidth / 2} y="4.6" width={badgeWidth} height="6.2" rx="3.1" />
        <text x={speedBadgeCenter} y="8.75" text-anchor="middle">» {speedLabel}</text>
      </g>
    {/if}
    <line class="boundary" x1={silenceStart} y1="1" x2={silenceStart} y2="30" />
    <line class="boundary" x1={silenceEnd} y1="1" x2={silenceEnd} y2="30" />
    <text x="50" y="33" text-anchor="middle">{silenceLabel}</text>
  </svg>

  <div class="zoom-bridge" aria-hidden="true"><span></span><b>⌄</b><span></span></div>

  <div class="silence-zoom">
    <div class="zoom-label">{silenceLabel}</div>
    <div class="zoom-graph">
    <svg viewBox="0 0 100 27" preserveAspectRatio="none" role="img" aria-label={`${silenceLabel}: ${speedLabel}`}>
      <rect class="zoom-background" x={zoomStart} y="1" width={zoomWidth} height="24" rx="1.2" />
      <rect class="speed-zone" x={detailSpeedStart} y="1" width={detailSpeedWidth} height="24" rx="1.2" />
      <line class="threshold" x1={zoomStart} y1="11" x2={zoomEnd} y2="11" vector-effect="non-scaling-stroke" />
      <path class="wave quiet-wave" vector-effect="non-scaling-stroke" d="M4 18 C8 18 9 16 13 18 S19 20 23 18 S29 16 33 18 S39 20 43 18 S49 16 53 18 S59 20 63 18 S69 16 73 18 S79 20 83 18 S89 16 93 18 S95 19 96 18" />
      <line class="zoom-boundary" x1={zoomStart} y1="0" x2={zoomStart} y2="27" vector-effect="non-scaling-stroke" />
      <line class="zoom-boundary" x1={zoomEnd} y1="0" x2={zoomEnd} y2="27" vector-effect="non-scaling-stroke" />
    </svg>
    {#if detailSpeedWidth >= 16}
      <div class="html-speed-badge" style={`left: ${detailBadgeCenter}%`}>» {speedLabel}</div>
    {/if}
    </div>

    <div class="margin-controls">
      <label class="before-control">
        <span>{beforeLabel} <b>{Math.round(marginBefore * 1000)} ms</b></span>
        <input
          type="range"
          min={minBefore}
          max={maxBefore}
          step={stepBefore}
          {disabled}
          bind:value={marginBefore}
          on:input={() => dispatch('inputBefore')}
        >
      </label>
      <label class="after-control">
        <span>{afterLabel} <b>{Math.round(marginAfter * 1000)} ms</b></span>
        <input
          type="range"
          min={minAfter}
          max={maxAfter}
          step={stepAfter}
          {disabled}
          bind:value={marginAfter}
          on:input={() => dispatch('inputAfter')}
        >
      </label>
    </div>
  </div>
</section>

<style>
  .preview {
    margin-top: 0.9rem;
    padding: 0.8rem;
    border: 1px solid var(--popup-border);
    border-radius: 0.75rem;
    background: var(--popup-surface-soft);
  }
  .overview {
    display: block;
    width: 100%;
    height: min(34vw, 190px);
    margin-top: 0.55rem;
    overflow: visible;
  }
  .silence { fill: color-mix(in srgb, var(--popup-muted) 10%, transparent); }
  .zoom-background { fill: color-mix(in srgb, var(--popup-muted) 8%, transparent); }
  .speed-zone { fill: color-mix(in srgb, #f2c94c 38%, transparent); }
  .speed-badge rect {
    fill: #f2c94c;
    filter: drop-shadow(0 0.6px 1px rgb(0 0 0 / 0.28));
  }
  .speed-badge text {
    fill: #31280a;
    font-size: 2.75px;
    font-weight: 800;
  }
  .threshold {
    stroke: #ef6262;
    stroke-width: 0.45;
    stroke-dasharray: 2 1.4;
    animation: threshold-flow 1.4s linear infinite;
  }
  .wave {
    fill: none;
    stroke: var(--popup-text);
    stroke-width: 1.35;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .quiet-wave { stroke-width: 2; }
  .silence-zoom .threshold { stroke-width: 2; }
  .boundary { stroke: var(--popup-muted); stroke-width: 0.35; stroke-dasharray: 1.4 1.2; }
  .zoom-boundary { stroke: var(--popup-muted); stroke-width: 2; stroke-dasharray: 5 5; }
  text { fill: var(--popup-muted); font-size: 3.2px; }
  .zoom-bridge {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.55rem;
    width: 42%;
    margin: -0.15rem auto 0.15rem;
    color: var(--popup-muted);
  }
  .zoom-bridge span { border-top: 1px solid var(--popup-border); }
  .zoom-bridge b { font-size: 1.25rem; font-weight: 500; }
  .silence-zoom {
    padding: 0.55rem 0.7rem 0.65rem;
    border: 1px solid color-mix(in srgb, #f2c94c 48%, var(--popup-border));
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--popup-surface) 76%, transparent);
  }
  .zoom-label {
    margin-bottom: 0.25rem;
    color: var(--popup-muted);
    text-align: center;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .silence-zoom svg { display: block; width: 100%; height: min(22vw, 120px); }
  .zoom-graph { position: relative; }
  .html-speed-badge {
    position: absolute;
    top: 10%;
    transform: translateX(-50%);
    min-width: 4.6rem;
    padding: 0.28rem 0.65rem;
    border-radius: 999px;
    color: #31280a;
    background: #f2c94c;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.24);
    text-align: center;
    font-size: 0.86rem;
    font-weight: 800;
    white-space: nowrap;
  }
  .margin-controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    width: 92%;
    margin: 0.25rem auto 0;
  }
  .margin-controls label { min-width: 0; }
  .margin-controls span {
    display: flex;
    justify-content: space-between;
    gap: 0.4rem;
    color: var(--popup-muted);
    font-size: 0.8rem;
  }
  .margin-controls b { color: var(--popup-text); font-variant-numeric: tabular-nums; }
  .margin-controls input {
    width: calc(100% + 14px);
    margin: 0.25rem 0 0 -7px;
    accent-color: #f2c94c;
  }
  .after-control input { direction: rtl; }

  @keyframes threshold-flow { to { stroke-dashoffset: -6.8; } }
  @media (prefers-reduced-motion: reduce) { .threshold { animation: none; } }
</style>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let value: number;
  export let min: number;
  export let max: number;
  export let step: number;
  export let decreaseLabel: string;
  export let increaseLabel: string;

  const dispatch = createEventDispatcher<{ input: void }>();

  function changeBy(direction: -1 | 1) {
    const next = Math.max(min, Math.min(max, value + direction * step));
    value = Number(next.toFixed(4));
    dispatch('input');
  }

  $: displayedValue = Number(value.toFixed(2));
</script>

<div class="stepper" role="group" aria-label="Video speed">
  <button
    type="button"
    aria-label={decreaseLabel}
    title={decreaseLabel}
    disabled={value <= min}
    on:click={() => changeBy(-1)}
  >−</button>
  <output aria-live="polite">{displayedValue}×</output>
  <button
    type="button"
    aria-label={increaseLabel}
    title={increaseLabel}
    disabled={value >= max}
    on:click={() => changeBy(1)}
  >+</button>
</div>

<style>
  .stepper {
    display: grid;
    grid-template-columns: 2.35rem minmax(4rem, auto) 2.35rem;
    align-items: center;
    width: fit-content;
    margin: 0.7rem auto 0.05rem;
    padding: 0.24rem;
    border: 1px solid var(--popup-border-strong, var(--popup-border));
    border-radius: 999px;
    background: var(--popup-surface-soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--popup-text) 4%, transparent);
  }

  button {
    width: 2.35rem;
    height: 2.35rem;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: color-mix(in srgb, var(--popup-text) 10%, transparent);
    font-size: 1.35rem;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--popup-accent) 18%, transparent);
  }

  button:disabled {
    cursor: default;
    opacity: 0.35;
  }

  output {
    min-width: 4rem;
    text-align: center;
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>

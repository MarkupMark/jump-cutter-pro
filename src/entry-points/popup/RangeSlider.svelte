<!--
Copyright (C) 2021, 2022  WofWca <wofwca@protonmail.com>

This file is part of Jump Cutter Browser Extension.

Jump Cutter Browser Extension is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Jump Cutter Browser Extension is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with Jump Cutter Browser Extension.  If not, see <https://www.gnu.org/licenses/>.
-->

<svelte:options
  immutable={true}
/>
<script lang="ts">
  export let value: number;
  export let label: string;
  export let fractionalDigits: number = 3;
  export let valueScale: number = 1;
  export let valueSuffix: string = '';
  export let min: number | string | undefined = undefined;
  export let max: number | string | undefined = undefined;
  export let step: number | string | undefined = undefined;

  type SvelteActionParameters = any;
  type SvelteAction = (node: HTMLElement, parameters: SvelteActionParameters) => {
    update?: (parameters: SvelteActionParameters) => void,
    destroy?: () => void,
  };

  export let useForInput: SvelteAction = () => ({});
  export let useForInputParams: SvelteActionParameters = undefined;

  let displayedValue: number;

  function scaleInputAttr(val: number | string | undefined) {
    if (val == undefined || val === '') {
      return val;
    }

    const numericVal = Number(val);
    if (Number.isFinite(numericVal)) {
      return numericVal * valueScale;
    }

    return val;
  }

  $: displayedValue = value * valueScale;
  $: displayedMin = scaleInputAttr(min);
  $: displayedMax = scaleInputAttr(max);
  $: displayedStep = scaleInputAttr(step);

  function onInputSyncScaledValue() {
    value = displayedValue / valueScale;
  }
</script>

<!-- Disabling the warning because it's false – apparently, it can't detect an input if it's not a direct child.
TODO. -->
<!-- svelte-ignore a11y-label-has-associated-control -->
<label>
  <span>{label}</span>
  <div class="range-and-value">
    <input
      type="range"
      {...$$restProps}
      bind:value={displayedValue}
      min={displayedMin}
      max={displayedMax}
      step={displayedStep}
      use:useForInput={useForInputParams}
      on:input={onInputSyncScaledValue}
      on:input
    >
    <span
      aria-hidden="true"
      class="number-representation"
    >{displayedValue.toFixed(fractionalDigits)}{valueSuffix}</span>
  </div>
</label>

<style>
  label {
    display: block;
    margin-top: 1rem;
  }
  .range-and-value {
    display: flex;
    align-items: center;
  }
  input {
    flex-grow: 1;
  }
  input:active::-webkit-slider-thumb {
    transform: scale(1.1);
  }
  .number-representation {
    /* So they don't chane width when thir value changes. */
    min-width: var(--number-representation-min-width);
    text-align: end;
  }
</style>

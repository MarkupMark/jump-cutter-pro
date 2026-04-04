/**
 * @license
 * Copyright (C) 2026  OpenAI
 *
 * This file is part of Jump Cutter Browser Extension.
 *
 * Jump Cutter Browser Extension is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Jump Cutter Browser Extension is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Jump Cutter Browser Extension.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { Settings } from '@/settings';
import { getMessage } from '@/helpers';

type OverlaySettings = Pick<Settings, 'soundedSpeed' | 'popupSoundedSpeedMin' | 'popupSoundedSpeedMax'>;

export default class PlaybackSpeedOverlay {
  private readonly host = document.createElement('div');
  private readonly shadowRoot = this.host.attachShadow({ mode: 'open' });
  private readonly panel = document.createElement('div');
  private readonly minusButton = document.createElement('button');
  private readonly speedLabel = document.createElement('span');
  private readonly plusButton = document.createElement('button');

  private activeElement: HTMLVideoElement | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private hideTimeoutId: number | undefined;
  private hoveredElement = false;
  private hoveredOverlay = false;
  private expanded = false;
  private visible = false;
  private destroyed = false;

  private settings: OverlaySettings = {
    soundedSpeed: 1,
    popupSoundedSpeedMin: 0.25,
    popupSoundedSpeedMax: 4,
  };

  constructor(
    private readonly onSoundedSpeedChange: (newSpeed: number) => void,
  ) {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }

      .panel {
        display: inline-flex;
        align-items: center;
        gap: 0;
        padding: 4px;
        border-radius: 999px;
        background: rgba(12, 14, 18, 0.18);
        border: 1px solid rgba(255, 255, 255, 0.18);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(14px) saturate(125%);
        -webkit-backdrop-filter: blur(14px) saturate(125%);
        color: #fff;
        font: 600 12px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: nowrap;
        user-select: none;
        opacity: 0;
        transform: translateY(-4px) scale(0.96);
        transition:
          opacity 140ms ease,
          transform 140ms ease,
          background-color 180ms ease,
          border-color 180ms ease;
      }

      .panel.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      .panel.expanded {
        background: rgba(12, 14, 18, 0.3);
        border-color: rgba(255, 255, 255, 0.26);
      }

      .speed-label {
        min-width: 52px;
        padding: 6px 10px;
        text-align: center;
        letter-spacing: 0.01em;
      }

      .control {
        width: 0;
        min-width: 0;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
        color: inherit;
        cursor: pointer;
        opacity: 0;
        overflow: hidden;
        transform: scale(0.85);
        transition:
          width 180ms ease,
          opacity 120ms ease,
          margin 180ms ease,
          transform 180ms ease,
          background-color 140ms ease;
      }

      .panel.expanded .control {
        width: 28px;
        margin: 0 2px;
        opacity: 1;
        transform: scale(1);
      }

      .control:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.2);
      }

      .control:disabled {
        cursor: not-allowed;
        opacity: 0.35;
      }
    `;

    this.minusButton.className = 'control';
    this.minusButton.type = 'button';
    this.minusButton.textContent = '-';

    this.speedLabel.className = 'speed-label';

    this.plusButton.className = 'control';
    this.plusButton.type = 'button';
    this.plusButton.textContent = '+';

    this.panel.className = 'panel';
    this.panel.append(this.minusButton, this.speedLabel, this.plusButton);
    this.shadowRoot.append(style, this.panel);

    this.host.style.position = 'fixed';
    this.host.style.left = '0';
    this.host.style.top = '0';
    this.host.style.transform = 'translate(-9999px, -9999px)';
    this.host.style.zIndex = '2147483647';
    this.host.style.pointerEvents = 'none';

    this.minusButton.ariaLabel = `${getMessage('decreaseSettingValue')} ${getMessage('soundedSpeed')}`;
    this.plusButton.ariaLabel = `${getMessage('increaseSettingValue')} ${getMessage('soundedSpeed')}`;
    this.panel.title = getMessage('soundedSpeed');

    this.panel.addEventListener('mouseenter', this.onOverlayMouseEnter);
    this.panel.addEventListener('mouseleave', this.onOverlayMouseLeave);
    this.minusButton.addEventListener('mousedown', this.preventDefaultInteraction);
    this.plusButton.addEventListener('mousedown', this.preventDefaultInteraction);
    this.minusButton.addEventListener('click', this.onDecreaseClick);
    this.plusButton.addEventListener('click', this.onIncreaseClick);

    window.addEventListener('scroll', this.updatePosition, true);
    window.addEventListener('resize', this.updatePosition, { passive: true });
    document.addEventListener('fullscreenchange', this.onFullscreenChange, { passive: true });

    this.ensureHostAttached();
    this.render();
  }

  updateSettings(settings: OverlaySettings): void {
    this.settings = settings;
    this.render();
    this.updatePosition();
  }

  setActiveElement(element: HTMLMediaElement | undefined): void {
    if (element === this.activeElement) {
      this.ensureHostAttached();
      this.render();
      this.updatePosition();
      return;
    }

    this.detachFromActiveElement();

    if (!(element instanceof HTMLVideoElement)) {
      this.syncVisibility(false);
      return;
    }

    this.activeElement = element;
    element.addEventListener('mouseenter', this.onElementMouseEnter, { passive: true });
    element.addEventListener('mouseleave', this.onElementMouseLeave, { passive: true });

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.updatePosition);
      this.resizeObserver.observe(element);
    }

    this.ensureHostAttached();
    this.render();
    this.updatePosition();
  }

  destroy(): void {
    this.destroyed = true;
    this.detachFromActiveElement();
    if (this.hideTimeoutId !== undefined) {
      clearTimeout(this.hideTimeoutId);
      this.hideTimeoutId = undefined;
    }

    this.panel.removeEventListener('mouseenter', this.onOverlayMouseEnter);
    this.panel.removeEventListener('mouseleave', this.onOverlayMouseLeave);
    this.minusButton.removeEventListener('mousedown', this.preventDefaultInteraction);
    this.plusButton.removeEventListener('mousedown', this.preventDefaultInteraction);
    this.minusButton.removeEventListener('click', this.onDecreaseClick);
    this.plusButton.removeEventListener('click', this.onIncreaseClick);
    window.removeEventListener('scroll', this.updatePosition, true);
    window.removeEventListener('resize', this.updatePosition);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.host.remove();
  }

  private readonly preventDefaultInteraction = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onDecreaseClick = (event: Event) => {
    this.preventDefaultInteraction(event);
    this.adjustSoundedSpeed(-0.05);
  };

  private readonly onIncreaseClick = (event: Event) => {
    this.preventDefaultInteraction(event);
    this.adjustSoundedSpeed(0.05);
  };

  private adjustSoundedSpeed(delta: number): void {
    const step = 0.05;
    const min = this.settings.popupSoundedSpeedMin;
    const max = this.settings.popupSoundedSpeedMax;
    const nextValue = Math.min(
      max,
      Math.max(
        min,
        Math.round((this.settings.soundedSpeed + delta) / step) * step,
      ),
    );
    const normalizedValue = Number(nextValue.toFixed(2));

    if (normalizedValue === this.settings.soundedSpeed) {
      return;
    }

    this.onSoundedSpeedChange(normalizedValue);
  }

  private readonly onElementMouseEnter = () => {
    this.hoveredElement = true;
    this.cancelHide();
    this.syncVisibility(true);
  };

  private readonly onElementMouseLeave = (event: MouseEvent) => {
    if (event.relatedTarget instanceof Node && this.panel.contains(event.relatedTarget)) {
      return;
    }
    this.hoveredElement = false;
    this.scheduleHide();
  };

  private readonly onOverlayMouseEnter = () => {
    this.hoveredOverlay = true;
    this.cancelHide();
    this.syncVisibility(true, true);
  };

  private readonly onOverlayMouseLeave = (event: MouseEvent) => {
    if (event.relatedTarget === this.activeElement) {
      this.hoveredOverlay = false;
      this.syncVisibility(true, false);
      return;
    }
    this.hoveredOverlay = false;
    this.expanded = false;
    this.scheduleHide();
  };

  private readonly onFullscreenChange = () => {
    this.ensureHostAttached();
    this.updatePosition();
  };

  private scheduleHide(): void {
    this.cancelHide();
    this.hideTimeoutId = window.setTimeout(() => {
      if (!this.hoveredElement && !this.hoveredOverlay) {
        this.syncVisibility(false);
      } else {
        this.syncVisibility(true, this.hoveredOverlay);
      }
    }, 120);
  }

  private cancelHide(): void {
    if (this.hideTimeoutId !== undefined) {
      clearTimeout(this.hideTimeoutId);
      this.hideTimeoutId = undefined;
    }
  }

  private detachFromActiveElement(): void {
    this.hoveredElement = false;
    this.hoveredOverlay = false;
    this.expanded = false;
    this.cancelHide();

    if (!this.activeElement) {
      return;
    }

    this.activeElement.removeEventListener('mouseenter', this.onElementMouseEnter);
    this.activeElement.removeEventListener('mouseleave', this.onElementMouseLeave);
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.activeElement = undefined;
    this.syncVisibility(false);
  }

  private ensureHostAttached(): void {
    const targetParent = document.fullscreenElement ?? document.documentElement;
    if (!targetParent) {
      return;
    }
    if (this.host.parentElement !== targetParent) {
      targetParent.appendChild(this.host);
    }
  }

  private syncVisibility(visible: boolean, expanded = false): void {
    this.visible = visible && !!this.activeElement && this.activeElement.isConnected;
    this.expanded = this.visible && expanded;
    this.render();
    this.updatePosition();
  }

  private readonly updatePosition = () => {
    if (!this.visible || !this.activeElement || !this.activeElement.isConnected || this.destroyed) {
      this.host.style.pointerEvents = 'none';
      this.host.style.transform = 'translate(-9999px, -9999px)';
      return;
    }

    const rect = this.activeElement.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 80 || rect.bottom <= 0 || rect.right <= 0) {
      this.host.style.pointerEvents = 'none';
      this.host.style.transform = 'translate(-9999px, -9999px)';
      return;
    }

    this.ensureHostAttached();

    const margin = 12;
    const panelRect = this.panel.getBoundingClientRect();
    const panelWidth = panelRect.width || (this.expanded ? 124 : 60);
    const panelHeight = panelRect.height || 36;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const rightEdge = Math.min(
      viewportWidth - margin,
      Math.max(margin + panelWidth, rect.right - margin),
    );
    const top = Math.min(
      viewportHeight - panelHeight - margin,
      Math.max(margin, rect.top + margin),
    );

    this.host.style.pointerEvents = 'auto';
    this.host.style.left = `${Math.round(rightEdge)}px`;
    this.host.style.top = `${Math.round(top)}px`;
    this.host.style.transform = 'translateX(-100%)';
  };

  private render(): void {
    this.speedLabel.textContent = this.formatSpeed(this.settings.soundedSpeed);
    this.minusButton.disabled = this.settings.soundedSpeed <= this.settings.popupSoundedSpeedMin;
    this.plusButton.disabled = this.settings.soundedSpeed >= this.settings.popupSoundedSpeedMax;
    this.panel.classList.toggle('visible', this.visible);
    this.panel.classList.toggle('expanded', this.expanded);
  }

  private formatSpeed(speed: number): string {
    return `${speed.toFixed(2).replace(/\.?0+$/, '')}x`;
  }
}

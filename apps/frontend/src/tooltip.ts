export function createTooltipControl(id: string, label: string, text: string): HTMLElement {
  const control = document.createElement('span');
  control.className = 'tooltip-control';
  const trigger = document.createElement('button');
  trigger.className = 'tooltip-trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-label', `Ajuda sobre ${label}`);
  trigger.setAttribute('aria-controls', id);
  trigger.setAttribute('aria-expanded', 'false');
  trigger.dataset['tooltipTarget'] = id;
  trigger.textContent = '[?]';
  const tooltip = document.createElement('span');
  tooltip.className = 'tooltip';
  tooltip.id = id;
  tooltip.role = 'tooltip';
  tooltip.hidden = true;
  tooltip.textContent = text;
  control.append(trigger, tooltip);
  return control;
}

export class TooltipController {
  public constructor(private readonly root: HTMLElement) {}

  public start(): void {
    this.root.addEventListener('pointerover', this.handlePointerOver);
    this.root.addEventListener('pointerout', this.handlePointerOut);
    this.root.addEventListener('focusin', this.handleFocusIn);
    this.root.addEventListener('focusout', this.handleFocusOut);
    this.root.addEventListener('keydown', this.handleKeyDown);
    this.root.addEventListener('click', this.handleClick);
  }

  public destroy(): void {
    this.root.removeEventListener('pointerover', this.handlePointerOver);
    this.root.removeEventListener('pointerout', this.handlePointerOut);
    this.root.removeEventListener('focusin', this.handleFocusIn);
    this.root.removeEventListener('focusout', this.handleFocusOut);
    this.root.removeEventListener('keydown', this.handleKeyDown);
    this.root.removeEventListener('click', this.handleClick);
  }

  private readonly handlePointerOver = (event: PointerEvent): void => {
    const trigger = this.triggerFrom(event.target);

    if (trigger !== null) {
      this.open(trigger);
    }
  };

  private readonly handlePointerOut = (event: PointerEvent): void => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const control = target.closest('.tooltip-control');

    if (control !== null && !control.contains(event.relatedTarget as Node | null)) {
      const trigger = control.querySelector<HTMLButtonElement>('.tooltip-trigger');

      if (trigger !== null) {
        this.close(trigger);
      }
    }
  };

  private readonly handleFocusIn = (event: FocusEvent): void => {
    const trigger = this.triggerFrom(event.target);

    if (trigger !== null) {
      this.open(trigger);
    }
  };

  private readonly handleFocusOut = (event: FocusEvent): void => {
    const trigger = this.triggerFrom(event.target);

    if (trigger === null) {
      return;
    }

    const control = trigger.closest('.tooltip-control');

    if (control !== null && !control.contains(event.relatedTarget as Node | null)) {
      this.close(trigger);
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return;
    }

    const trigger = this.triggerFrom(event.target);

    if (trigger !== null) {
      this.close(trigger);
    }
  };

  private readonly handleClick = (event: MouseEvent): void => {
    const trigger = this.triggerFrom(event.target);

    if (trigger !== null) {
      this.open(trigger);
    }
  };

  private triggerFrom(target: EventTarget | null): HTMLButtonElement | null {
    return target instanceof Element ? target.closest<HTMLButtonElement>('.tooltip-trigger') : null;
  }

  private open(trigger: HTMLButtonElement): void {
    const tooltip = this.tooltipFor(trigger);

    if (tooltip !== null) {
      trigger.setAttribute('aria-expanded', 'true');
      tooltip.hidden = false;
    }
  }

  private close(trigger: HTMLButtonElement): void {
    const tooltip = this.tooltipFor(trigger);

    if (tooltip !== null) {
      trigger.setAttribute('aria-expanded', 'false');
      tooltip.hidden = true;
    }
  }

  private tooltipFor(trigger: HTMLButtonElement): HTMLElement | null {
    const id = trigger.dataset['tooltipTarget'];
    return id === undefined
      ? null
      : (Array.from(this.root.querySelectorAll<HTMLElement>('[role="tooltip"]')).find(
          (tooltip) => tooltip.id === id,
        ) ?? null);
  }
}

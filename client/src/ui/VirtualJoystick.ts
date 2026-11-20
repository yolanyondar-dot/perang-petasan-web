/** Joystick virtual berbasis DOM untuk mobile (dual-thumb). */
export class VirtualJoystick {
  readonly element: HTMLDivElement;
  readonly vector: { x: number; y: number } = { x: 0, y: 0 };
  private readonly stick: HTMLDivElement;
  private pointerId: number | null = null;
  private readonly radius = 52;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'joystick';
    this.stick = document.createElement('div');
    this.stick.className = 'joystick-stick';
    this.element.appendChild(this.stick);
    parent.appendChild(this.element);

    this.element.addEventListener('pointerdown', (event) => {
      if (this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      this.element.setPointerCapture(event.pointerId);
      this.update(event);
    });
    this.element.addEventListener('pointermove', (event) => {
      if (event.pointerId === this.pointerId) this.update(event);
    });
    const release = (event: PointerEvent): void => {
      if (event.pointerId === this.pointerId) this.reset();
    };
    this.element.addEventListener('pointerup', release);
    this.element.addEventListener('pointercancel', release);
  }

  get active(): boolean {
    return this.pointerId !== null;
  }

  private update(event: PointerEvent): void {
    const rect = this.element.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(distance, this.radius);
    this.stick.style.transform = `translate(${dx / distance * clamped}px, ${dy / distance * clamped}px)`;
    this.vector.x = dx / distance * (clamped / this.radius);
    this.vector.y = dy / distance * (clamped / this.radius);
  }

  reset(): void {
    this.pointerId = null;
    this.vector.x = 0;
    this.vector.y = 0;
    this.stick.style.transform = 'translate(0px, 0px)';
  }

  destroy(): void {
    this.element.remove();
  }
}

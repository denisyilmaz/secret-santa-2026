import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, viewChild } from '@angular/core';
import { Motion } from '../core/motion';

interface Shape {
  x: number;
  y: number;
  size: number;
  kind: number;
  color: string;
  rot: number;
  spin: number;
  dx: number;
  dy: number;
}
interface Flake {
  x: number;
  y: number;
  r: number;
  fall: number;
  sway: number;
  phase: number;
}

const COLORS = ['#e5553b', '#9aae3f', '#ecb23a', '#e8899a', '#45a69d', '#e07b2a'];

/**
 * The night sky behind everything: a pine-green gradient, drifting squiggles and
 * triangles, and slow snow. With motion off it paints one still frame.
 */
@Component({
  selector: 'wm-backdrop',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #cv aria-hidden="true"></canvas>`,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class Backdrop {
  private readonly motion = inject(Motion);
  private readonly cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private shapes: Shape[] = [];
  private flakes: Flake[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private ready = false;

  private readonly destroy = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      this.ready = true;
      this.resize(true);
      let t: ReturnType<typeof setTimeout>;
      const onResize = () => {
        clearTimeout(t);
        t = setTimeout(() => this.resize(false), 180);
      };
      addEventListener('resize', onResize);
      this.destroy.onDestroy(() => {
        removeEventListener('resize', onResize);
        cancelAnimationFrame(this.raf);
      });
      this.kick();
    });
    effect(() => {
      this.motion.enabled();
      if (this.ready) this.kick();
    });
  }

  private resize(force: boolean): void {
    const w = innerWidth;
    const h = Math.max(innerHeight, 480);
    // Phones fire resize when the address bar slides away: keep the scene, just refit.
    const rebuild = force || Math.abs(w - this.w) > 2;
    this.w = w;
    this.h = h;
    this.dpr = Math.min(devicePixelRatio || 1, 1.5);
    const el = this.cv().nativeElement;
    el.width = Math.round(w * this.dpr);
    el.height = Math.round(h * this.dpr);
    if (rebuild) this.populate();
    if (!this.motion.enabled()) this.paint(0);
  }

  private populate(): void {
    const area = this.w * this.h;
    const nShapes = Math.min(70, Math.round(area / 16000));
    const nFlakes = Math.min(90, Math.round(area / 9000));
    this.shapes = Array.from({ length: nShapes }, (_, i) => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      size: 9 + Math.random() * 12,
      kind: i % 5,
      color: COLORS[i % COLORS.length],
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.5,
      dx: (Math.random() - 0.5) * 9,
      dy: (Math.random() - 0.5) * 9,
    }));
    this.flakes = Array.from({ length: nFlakes }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      r: 1.2 + Math.random() * 2.6,
      fall: 14 + Math.random() * 30,
      sway: 6 + Math.random() * 16,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  private kick(): void {
    cancelAnimationFrame(this.raf);
    if (!this.motion.enabled()) {
      this.paint(0);
      return;
    }
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.08, (now - this.last) / 1000);
      // About 30 frames a second is plenty for slow drift, and easier on phones.
      if (dt >= 0.03) {
        this.last = now;
        this.paint(dt);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private paint(dt: number): void {
    const g = this.cv().nativeElement.getContext('2d');
    if (!g) return;
    const { w, h } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#10332b');
    sky.addColorStop(1, '#1f4d3c');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    g.lineWidth = 4;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.globalAlpha = 0.32;
    for (const s of this.shapes) {
      s.x = (s.x + s.dx * dt + w + 40) % (w + 40);
      s.y = (s.y + s.dy * dt + h + 40) % (h + 40);
      s.rot += s.spin * dt;
      g.save();
      g.translate(s.x - 20, s.y - 20);
      g.rotate(s.rot);
      g.strokeStyle = s.color;
      g.fillStyle = s.color;
      g.beginPath();
      const z = s.size;
      if (s.kind === 0) {
        for (let k = 0; k <= 24; k++) {
          const x = ((k - 12) * z) / 5;
          const y = (Math.sin((k / 24) * Math.PI * 4) * z) / 2.4;
          if (k) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      } else if (s.kind === 1) {
        g.moveTo(0, -z);
        g.lineTo(z, z * 0.8);
        g.lineTo(-z, z * 0.8);
        g.closePath();
        g.stroke();
      } else if (s.kind === 2) {
        g.arc(0, 0, z / 2.6, 0, Math.PI * 2);
        g.fill();
      } else if (s.kind === 3) {
        g.moveTo(-z * 0.7, 0);
        g.lineTo(z * 0.7, 0);
        g.moveTo(0, -z * 0.7);
        g.lineTo(0, z * 0.7);
        g.stroke();
      } else {
        for (let k = 0; k < 5; k++) {
          const x = (k - 2) * z * 0.6;
          const y = k % 2 ? z * 0.4 : -z * 0.4;
          if (k) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      }
      g.restore();
    }

    if (dt > 0) {
      g.fillStyle = '#fff';
      for (const f of this.flakes) {
        f.y += f.fall * dt;
        f.phase += dt * 0.9;
        if (f.y > h + 6) {
          f.y = -6;
          f.x = Math.random() * w;
        }
        g.globalAlpha = 0.35 + f.r / 7;
        g.beginPath();
        g.arc(f.x + Math.sin(f.phase) * f.sway, f.y, f.r, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }
}

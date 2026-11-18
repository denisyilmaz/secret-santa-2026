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

const COLORS = ['#fffaf0', '#fffaf0', '#7ab7a9', '#cf2e26', '#f0b53a', '#1d6b5f'];

/**
 * The night sky behind everything: an aqua gradient, drifting mid-century starbursts
 * and diamonds, and slow snow. With motion off it paints one still frame.
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
      r: 1.6 + Math.random() * 3,
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
    sky.addColorStop(0, '#a4d0c4');
    sky.addColorStop(1, '#cfe6dc');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of this.shapes) {
      s.x = (s.x + s.dx * dt + w + 40) % (w + 40);
      s.y = (s.y + s.dy * dt + h + 40) % (h + 40);
      s.rot += s.spin * dt;
      g.save();
      g.translate(s.x - 20, s.y - 20);
      g.rotate(s.rot);
      g.globalAlpha = 0.5;
      g.strokeStyle = s.color;
      g.fillStyle = s.color;
      g.lineWidth = 2;
      const z = s.size;
      g.beginPath();
      if (s.kind === 0) {
        // atomic starburst: eight rays, long and short in turn
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const r = k % 2 ? z * 0.55 : z * 1.15;
          g.moveTo(Math.cos(a) * z * 0.18, Math.sin(a) * z * 0.18);
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.stroke();
      } else if (s.kind === 1) {
        // four-point sparkle with pinched sides
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2;
          const b = a + Math.PI / 4;
          if (k) g.lineTo(Math.cos(a) * z, Math.sin(a) * z);
          else g.moveTo(Math.cos(a) * z, Math.sin(a) * z);
          g.lineTo(Math.cos(b) * z * 0.22, Math.sin(b) * z * 0.22);
        }
        g.closePath();
        g.fill();
      } else if (s.kind === 2) {
        g.arc(0, 0, z / 3.2, 0, Math.PI * 2);
        g.fill();
      } else if (s.kind === 3) {
        // diamond
        g.moveTo(0, -z * 0.8);
        g.lineTo(z * 0.5, 0);
        g.lineTo(0, z * 0.8);
        g.lineTo(-z * 0.5, 0);
        g.closePath();
        g.stroke();
      } else {
        // six rays with a dot on every tip
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          g.moveTo(0, 0);
          g.lineTo(Math.cos(a) * z * 0.8, Math.sin(a) * z * 0.8);
        }
        g.stroke();
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          g.beginPath();
          g.arc(Math.cos(a) * z * 0.95, Math.sin(a) * z * 0.95, 2, 0, Math.PI * 2);
          g.fill();
        }
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
        g.globalAlpha = 0.6 + f.r / 12;
        g.beginPath();
        g.arc(f.x + Math.sin(f.phase) * f.sway, f.y, f.r, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }
}

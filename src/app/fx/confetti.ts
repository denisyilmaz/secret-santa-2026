import { Injectable, inject } from '@angular/core';
import { Motion } from '../core/motion';

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  rot: number;
  vr: number;
  born: number;
  life: number;
}

const COLORS = ['#cf2e26', '#1d6b5f', '#f0b53a', '#f2a3ad', '#6fbfb8', '#fffaf0'];

/** Paper confetti on one shared canvas above the page. Silent when motion is off. */
@Injectable({ providedIn: 'root' })
export class Confetti {
  private readonly motion = inject(Motion);
  private canvas: HTMLCanvasElement | null = null;
  private pieces: Piece[] = [];
  private running = false;

  /** A burst from the middle of an element, e.g. a checkbox that was just ticked. */
  burstFrom(el: Element, count = 40): void {
    const r = el.getBoundingClientRect();
    this.burst(r.left + r.width / 2, r.top + r.height / 2, count);
  }

  burst(x: number, y: number, count = 40): void {
    if (!this.motion.enabled()) return;
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 7;
      this.pieces.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        w: 6 + Math.random() * 8,
        h: 4 + Math.random() * 4,
        color: COLORS[i % COLORS.length],
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.6,
        born: now,
        life: 900 + Math.random() * 500,
      });
    }
    this.start();
  }

  /** Confetti falling from the top edge, for the big moments. */
  rain(duration = 2600): void {
    if (!this.motion.enabled()) return;
    const until = performance.now() + duration;
    const drop = () => {
      const now = performance.now();
      for (let i = 0; i < 7; i++) {
        this.pieces.push({
          x: Math.random() * innerWidth,
          y: -12,
          vx: (Math.random() - 0.5) * 2.4,
          vy: 2 + Math.random() * 3,
          w: 7 + Math.random() * 8,
          h: 4 + Math.random() * 5,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          rot: Math.random() * 6,
          vr: (Math.random() - 0.5) * 0.5,
          born: now,
          life: 2600 + Math.random() * 1200,
        });
      }
      this.start();
      if (now < until) setTimeout(drop, 70);
    };
    drop();
  }

  private start(): void {
    if (this.running) return;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('aria-hidden', 'true');
      this.canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
      document.body.appendChild(this.canvas);
    }
    const cv = this.canvas;
    const g = cv.getContext('2d');
    if (!g) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(innerWidth * dpr);
    cv.height = Math.round(innerHeight * dpr);
    this.running = true;
    const frame = (now: number) => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, innerWidth, innerHeight);
      this.pieces = this.pieces.filter((p) => now - p.born < p.life && p.y < innerHeight + 30);
      for (const p of this.pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.3;
        p.vx *= 0.99;
        p.rot += p.vr;
        g.save();
        g.globalAlpha = Math.min(1, (p.life - (now - p.born)) / 300);
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      }
      if (this.pieces.length) requestAnimationFrame(frame);
      else this.running = false;
    };
    requestAnimationFrame(frame);
  }
}

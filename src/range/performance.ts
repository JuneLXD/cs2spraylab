import type {Settings} from './config';

const policies = {
  high: {pixelRatio: 2, maxWidth: 2560, animationHz: 120, guideHz: 20, shadows: true},
  auto: {pixelRatio: 1.5, maxWidth: 1920, animationHz: 60, guideHz: 10, shadows: true},
  low: {pixelRatio: 1, maxWidth: 1280, animationHz: 45, guideHz: 8, shadows: false},
  performance: {pixelRatio: .75, maxWidth: 960, animationHz: 30, guideHz: 5, shadows: false}
};
export const qualityPolicy = (quality: Settings['quality']) => policies[quality];

export function renderPixelRatio(width: number, height: number, dpr: number, quality: Settings['quality'], adaptive = 1) {
  const policy = qualityPolicy(quality);
  // Bound both axes: an ultra-wide or portrait display must not undo the preset.
  return Math.min(dpr, policy.pixelRatio, policy.maxWidth / Math.max(1, width, height)) * adaptive;
}

export class FramePacer {
  private next = 0;
  private limit = -1;
  ready(timestamp: number, limit: number) {
    if (limit !== this.limit) {this.limit = limit; this.next = timestamp;}
    if (!limit) return true;
    if (timestamp + .5 < this.next) return false;
    const interval = 1000 / limit;
    this.next = this.next && timestamp < this.next + interval ? this.next + interval : timestamp + interval;
    return true;
  }
}

export class FrameMetrics {
  fps = 0;
  cpuMs = 0;
  p95Ms = 0;
  p99Ms = 0;
  worstMs = 0;
  private intervals=new Float64Array(2048);
  private costs=new Float64Array(2048);
  private sampleCount=0;
  private cursor=0;
  private wasActive=false;
  adaptive = 1;
  animationHz = policies.auto.animationHz;
  private elapsed = 0;
  private frames = 0;
  private cpu = 0;
  private warmup = 0;
  private slow = 0;
  private fast = 0;
  private cpuSlow = 0;
  private cpuFast = 0;
  animationRate(quality: Settings['quality']) {
    return quality === 'auto' ? this.animationHz : qualityPolicy(quality).animationHz;
  }
  sample(dt: number, cpuMs: number, adaptive: boolean, active: boolean, cap: number,frameSeconds=dt) {
    if (dt <= 0 || dt > .25) return false;
    if(active&&!this.wasActive) {
      this.sampleCount=this.cursor=0;
      this.p95Ms=this.p99Ms=this.worstMs=0;
      this.elapsed=this.frames=this.cpu=0;
    }
    this.wasActive=active;
    if(active&&Number.isFinite(frameSeconds)&&frameSeconds>0) {
      this.intervals[this.cursor]=frameSeconds*1000;this.costs[this.cursor]=cpuMs;
      this.cursor=(this.cursor+1)%this.intervals.length;this.sampleCount=Math.min(this.sampleCount+1,this.intervals.length);
    }
    this.elapsed += Number.isFinite(frameSeconds)&&frameSeconds>0?frameSeconds:dt; this.frames++; this.cpu += cpuMs;
    if (this.elapsed < .5) return false;
    this.fps = Math.round(this.frames / this.elapsed);
    this.cpuMs = this.cpu / this.frames;
    if(this.sampleCount) {
      const sorted=this.intervals.slice(0,this.sampleCount).sort();
      this.p95Ms=sorted[Math.ceil(this.sampleCount*.95)-1];this.p99Ms=sorted[Math.ceil(this.sampleCount*.99)-1];
      this.worstMs=sorted[this.sampleCount-1];
    }
    const window = this.elapsed;
    this.elapsed = this.frames = this.cpu = 0;
    if (!active) {this.slow = this.fast = this.cpuSlow = this.cpuFast = this.warmup = 0; return true;}
    this.warmup += window;
    if (!adaptive || this.warmup < 3) return true;
    const target = Math.min(60, cap || 60), budget = 1000 / target;
    // Resolution alone cannot relieve CPU-bound pose evaluation. Thin visual
    // sampling only after sustained pressure; simulation and aiming stay full rate.
    this.cpuSlow = this.cpuMs > budget * .75 ? this.cpuSlow + window : 0;
    this.cpuFast = this.cpuMs < budget * .45 ? this.cpuFast + window : 0;
    if (this.cpuSlow >= 1.5) {this.animationHz = Math.max(30, this.animationHz - 10); this.cpuSlow = this.cpuFast = 0;}
    if (this.cpuFast >= 8) {this.animationHz = Math.min(60, this.animationHz + 5); this.cpuSlow = this.cpuFast = 0;}
    const overloaded = this.fps < target * .8 || this.cpuMs > budget * .85;
    this.slow = overloaded ? this.slow + window : 0;
    this.fast = !overloaded && this.fps >= target * .97 && this.cpuMs < budget * .5 ? this.fast + window : 0;
    if (this.slow >= 1.5) {this.adaptive = Math.max(.5, this.adaptive - .1); this.slow = this.fast = 0;}
    if (this.fast >= 8) {this.adaptive = Math.min(1, this.adaptive + .05); this.slow = this.fast = 0;}
    return true;
  }
  resetResolution() {
    this.adaptive = 1; this.animationHz = policies.auto.animationHz;
    this.warmup = this.slow = this.fast = this.cpuSlow = this.cpuFast = 0;
  }
  report() {
    const frames=[];
    for(let i=0;i<this.sampleCount;i++) {
      const index=(this.cursor-this.sampleCount+i+this.intervals.length)%this.intervals.length;
      frames.push({intervalMs:+this.intervals[index].toFixed(3),cpuMs:+this.costs[index].toFixed(3)});
    }
    const sorted=frames.map(frame=>frame.intervalMs).sort((a,b)=>a-b);
    return {kind:'SprayLab rendered frame timings',note:'Browser render intervals and main-thread work; not physical input latency or GPU duration.',
      fps:frames.length?1000*frames.length/frames.reduce((sum,frame)=>sum+frame.intervalMs,0):0,
      p95Ms:sorted[Math.ceil(sorted.length*.95)-1]??0,p99Ms:sorted[Math.ceil(sorted.length*.99)-1]??0,
      worstMs:sorted[sorted.length-1]??0,frames};
  }
}

// Updated at 2 Hz, outside React's gameplay status updates.
export class PerformanceMeter {
  private element = document.createElement('button');
  private metrics?:FrameMetrics;
  constructor(host: HTMLElement) {
    this.element.type='button';
    this.element.className = 'performance-meter'; this.element.hidden = true;
    this.element.setAttribute('aria-label', 'Performance monitor'); host.append(this.element);
    this.element.addEventListener('click',()=>{
      if(!this.metrics)return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(this.metrics.report(),null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='spraylab-frame-times.json';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
  }
  configure(visible: boolean) {this.element.hidden = !visible;}
  update(metrics: FrameMetrics, ratio: number) {
    if (this.element.hidden) return;
    this.metrics=metrics;
    this.element.textContent = `${metrics.fps} FPS | p95 ${metrics.p95Ms.toFixed(1)} ms`;
    this.element.title = `CPU frame: ${metrics.cpuMs.toFixed(1)} ms. p99: ${metrics.p99Ms.toFixed(1)} ms. Worst: ${metrics.worstMs.toFixed(1)} ms. Render density: ${Math.round(ratio * 100)}%. Click to save frame timings.`;
  }
  dispose() {this.element.remove();}
}

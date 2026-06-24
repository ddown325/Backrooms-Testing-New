// renderer.ts — Three.js scene, camera, renderer, fog, ambient lighting.
// Tuned for low-end PCs: no shadows, no postprocessing, capped pixel ratio,
// fog used to hide chunk streaming.

import * as THREE from 'three';

export interface RendererSettings {
  renderScale: number;   // 0.5 .. 1.0
  fogDensity: number;    // 0.01 .. 0.06
  fov: number;           // 60 .. 90
  antialias: boolean;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private settings: RendererSettings;

  constructor(canvas: HTMLCanvasElement, settings: RendererSettings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * settings.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    // Yellowish Level-0 fog
    this.scene.fog = new THREE.FogExp2(0xb8a868, settings.fogDensity);
    this.scene.background = new THREE.Color(0xb8a868);

    this.camera = new THREE.PerspectiveCamera(
      settings.fov,
      window.innerWidth / window.innerHeight,
      0.05,
      120
    );
    this.camera.position.set(0, 1.7, 0);

    // Cheap global ambient + hemisphere — fluorescent feel
    const hemi = new THREE.HemisphereLight(0xfff4c0, 0x6a5a20, 0.55);
    this.scene.add(hemi);
    const amb = new THREE.AmbientLight(0xb8a868, 0.35);
    this.scene.add(amb);
  }

  applySettings(s: RendererSettings) {
    this.settings = s;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * s.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = s.fogDensity;
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}

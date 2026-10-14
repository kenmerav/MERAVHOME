import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { MeasuredElevation, RenderReview } from "./measuredRendering";

/** Shared physical geometry for browser and Blender. Coordinates/dimensions are inches. */
export function measuredGeometry(elevation: MeasuredElevation, review: RenderReview) {
  const root = new THREE.Group();
  function box(
    group: THREE.Group,
    name: string,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
    metal = 0,
    rough = 0.45,
  ) {
    const mat = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
    mat.name = name;
    const geom = new RoundedBoxGeometry(w, h, d, 2, Math.min(0.08, w / 10, h / 10, d / 10));
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  for (const e of review.elements) {
    const g = new THREE.Group();
    g.name = e.id;
    g.position.set(e.x, e.y, e.z);
    g.userData = { elementId: e.id };
    root.add(g);
    const w = e.width,
      h = e.height,
      d = e.depth,
      c = e.color;
    if (e.kind === "niche") {
      box(g, e.id + ":niche-back", w, h, 0.3, 0, h / 2, -d / 2, c);
      box(g, e.id + ":niche-left", 0.3, h, d, -w / 2, h / 2, 0, c);
      box(g, e.id + ":niche-right", 0.3, h, d, w / 2, h / 2, 0, c);
      box(g, e.id + ":niche-top", w, 0.3, d, 0, h, 0, c);
      box(g, e.id + ":niche-bottom", w, 0.3, d, 0, 0, 0, c);
    } else if (e.kind === "mirror") {
      box(
        g,
        e.id + ":mirror",
        w - 0.4,
        h - 0.4,
        Math.max(0.15, d - 0.2),
        0,
        h / 2,
        0,
        "#ebeff1",
        1,
        0.025,
      );
      for (const x of [-w / 2 + 0.1, w / 2 - 0.1])
        box(g, e.id + ":frame", 0.2, h, d, x, h / 2, 0, "#b7bdc1", 1, 0.16);
      for (const y of [0.1, h - 0.1])
        box(g, e.id + ":frame", w, 0.2, d, 0, y, 0, "#b7bdc1", 1, 0.16);
    } else if (e.kind === "cabinet") {
      box(g, e.id + ":cabinet", w, h, d, 0, h / 2, 0, c);
      if (e.front !== "open" && e.front !== "solid") {
        const n = e.front === "drawers" ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const dw = e.front === "drawers" ? w - 0.4 : (w - 0.6) / 2,
            dh = e.front === "drawers" ? (h - 0.8) / 3 : h - 3;
          const x = e.front === "drawers" ? 0 : (i - 0.5) * (w / 2),
            y = e.front === "drawers" ? 2 + (i + 0.5) * dh : 1.5 + dh / 2;
          box(g, e.id + ":front", dw, dh, 0.7, x, y, d / 2 + 0.25, c);
          box(g, e.id + ":inset", dw - 2, dh - 2, 0.3, x, y, d / 2 + 0.65, c);
          box(
            g,
            e.id + ":handle",
            e.front === "drawers" ? 5.0625 : 0.625,
            0.25,
            0.45,
            x,
            y,
            d / 2 + 1,
            "#b7bdc1",
            0.9,
            0.2,
          );
        }
      }
    } else if (e.kind === "faucet") {
      const material = new THREE.MeshStandardMaterial({
        color: c,
        metalness: 0.85,
        roughness: 0.22,
      });
      material.name = e.id + ":faucet";
      const points = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, h * 0.8, 0),
        new THREE.Vector3(0, h, d * 0.35),
        new THREE.Vector3(0, h * 0.8, d * 0.5),
      ];
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.3, 12, false),
        material,
      );
      g.add(tube);
      for (const x of [-w * 0.35, w * 0.35])
        box(g, e.id + ":handle", 0.65, h * 0.4, 0.65, x, h * 0.2, 0, c, 0.85, 0.2);
    } else if (e.kind === "light") {
      box(
        g,
        e.id + ":backplate",
        Math.min(w / 2, 5),
        Math.min(h, 4),
        0.5,
        0,
        h / 2,
        -d / 2,
        c,
        0.8,
        0.2,
      );
      box(g, e.id + ":bar", w, 0.35, 0.35, 0, h * 0.5, 0, c, 0.8, 0.2);
      for (let i = 0; i < 3; i++) {
        const globe = new THREE.Mesh(
          new THREE.SphereGeometry(Math.min(h * 0.4, w / 7, d * 0.5), 24, 16),
          new THREE.MeshStandardMaterial({
            color: "#eee8da",
            roughness: 0.35,
            emissive: "#e5caa3",
            emissiveIntensity: 0.15,
          }),
        );
        globe.material.name = e.id + ":shade";
        globe.position.set((i - 1) * w * 0.32, h * 0.5, d * 0.15);
        g.add(globe);
      }
    } else {
      const mesh = box(
        g,
        e.id + ":" + e.kind,
        w,
        h,
        d,
        0,
        h / 2,
        0,
        c,
        e.kind === "hardware" ? 0.8 : 0,
        e.kind === "countertop" ? 0.18 : 0.5,
      );
      if (e.kind === "glass") {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = 0.15;
        mat.roughness = 0.08;
        mat.depthWrite = false;
      }
    }
  }
  box(
    root,
    "floor",
    elevation.width,
    0.5,
    elevation.depth || 60,
    elevation.width / 2,
    -0.25,
    (elevation.depth || 60) / 2,
    "#ded4bf",
  );
  return root;
}

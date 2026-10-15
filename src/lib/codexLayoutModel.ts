import * as THREE from "three";
import { layoutBounds, type CodexLayout } from "./codexRenderingLayout";

/** Deterministic envelope geometry: no language/image model participates in these dimensions. */
export function codexLayoutModel(layout: CodexLayout) {
  const root = new THREE.Group();
  root.name = "Source-linked envelope model — inches";
  function box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
    opacity = 1,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        roughness: 0.65,
        depthWrite: opacity === 1,
      }),
    );
    mesh.position.set(x, y, z);
    return mesh;
  }
  for (const o of layout.objects) {
    const b = layoutBounds(o),
      g = new THREE.Group();
    g.name = o.name;
    g.userData = { id: o.id, specId: o.specId, evidence: o.evidence, units: "inches" };
    const assumed = Object.values(o.evidence).some((e) => e.basis === "assumption");
    const c = assumed
      ? "#d4a95a"
      : o.kind === "tub"
        ? "#f1f1ed"
        : o.kind === "toilet"
          ? "#dce3e5"
          : o.kind === "opening"
            ? "#90bdd2"
            : "#b8b0a2";
    if (o.kind === "tub") {
      const t = Math.min(1, b.width / 8, b.depth / 8, b.height / 8);
      g.add(box(b.width, t, b.depth, b.x + b.width / 2, b.y + t / 2, b.z + b.depth / 2, c));
      for (const x of [b.x + t / 2, b.x + b.width - t / 2])
        g.add(box(t, b.height, b.depth, x, b.y + b.height / 2, b.z + b.depth / 2, c));
      for (const z of [b.z + t / 2, b.z + b.depth - t / 2])
        g.add(box(b.width, b.height, t, b.x + b.width / 2, b.y + b.height / 2, z, c));
    } else {
      const opacity =
        o.kind === "glass" ? 0.18 : o.kind === "access" ? 0.12 : o.kind === "wall" ? 0.25 : 1;
      g.add(
        box(
          b.width,
          b.height,
          b.depth,
          b.x + b.width / 2,
          b.y + b.height / 2,
          b.z + b.depth / 2,
          o.kind === "access" ? "#4a9a69" : o.kind === "glass" ? "#73acb9" : c,
          opacity,
        ),
      );
    }
    const edgeGeom = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.width, b.height, b.depth));
    const edge = new THREE.LineSegments(
      edgeGeom,
      new THREE.LineBasicMaterial({
        color: o.kind === "access" ? "#4a9a69" : "#635c54",
        transparent: true,
        opacity: 0.7,
      }),
    );
    edge.position.set(b.x + b.width / 2, b.y + b.height / 2, b.z + b.depth / 2);
    g.add(edge);
    root.add(g);
  }
  return root;
}

/** Portable, repeatable source guides for handoff; identical coordinates to the 3D model. */
export function codexLayoutSvg(layout: CodexLayout, view: "plan" | "front" | "angled") {
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
    );
  const project = (x: number, y: number, z: number): [number, number] =>
    view === "plan" ? [x, z] : view === "front" ? [x, -y] : [x - z * 0.45, -y + z * 0.3];
  const corners = layout.objects.flatMap((o) => {
    const b = layoutBounds(o);
    return [0, 1].flatMap((x) =>
      [0, 1].flatMap((y) =>
        [0, 1].map((z) => project(b.x + x * b.width, b.y + y * b.height, b.z + z * b.depth)),
      ),
    );
  });
  const xs = corners.map((p) => p[0]),
    ys = corners.map((p) => p[1]);
  const minX = Math.min(0, ...xs),
    minY = Math.min(0, ...ys),
    maxX = Math.max(...xs),
    maxY = Math.max(...ys);
  const scale = Math.min(850 / Math.max(1, maxX - minX), 500 / Math.max(1, maxY - minY));
  const p = (x: number, y: number, z: number) => {
    const a = project(x, y, z);
    return `${70 + (a[0] - minX) * scale},${90 + (a[1] - minY) * scale}`;
  };
  const shapes = [...layout.objects]
    .sort((a, b) => a.z - b.z)
    .map((o) => {
      const b = layoutBounds(o),
        fill =
          o.kind === "glass"
            ? "#b4d9e1"
            : o.kind === "access"
              ? "#b5d7bb"
              : Object.values(o.evidence).some((e) => e.basis === "assumption")
                ? "#ead0a0"
                : "#e1ddd5";
      const faces =
        view === "plan"
          ? [
              [
                [0, 0, 0],
                [1, 0, 0],
                [1, 0, 1],
                [0, 0, 1],
              ],
            ]
          : view === "front"
            ? [
                [
                  [0, 0, 0],
                  [1, 0, 0],
                  [1, 1, 0],
                  [0, 1, 0],
                ],
              ]
            : [
                [
                  [0, 0, 1],
                  [1, 0, 1],
                  [1, 1, 1],
                  [0, 1, 1],
                ],
                [
                  [0, 0, 0],
                  [0, 0, 1],
                  [0, 1, 1],
                  [0, 1, 0],
                ],
                [
                  [0, 1, 0],
                  [1, 1, 0],
                  [1, 1, 1],
                  [0, 1, 1],
                ],
              ];
      const polys = faces
        .map(
          (f) =>
            `<polygon points="${f.map(([x, y, z]) => p(b.x + x * b.width, b.y + y * b.height, b.z + z * b.depth)).join(" ")}" fill="${fill}" fill-opacity="${o.kind === "glass" || o.kind === "access" ? 0.35 : 0.85}" stroke="#645c52"/>`,
        )
        .join("");
      const [cx, cy] = p(b.x + b.width / 2, b.y + b.height / 2, b.z + b.depth / 2).split(",");
      const number = layout.objects.indexOf(o) + 1;
      return `<g><title>${esc(o.name)}: ${o.width} W × ${o.depth} D × ${o.height} H inches; ${o.quarterTurns * 90}°</title>${polys}<circle cx="${cx}" cy="${cy}" r="10" fill="#faf8f4" stroke="#645c52"/><text x="${cx}" y="${Number(cy) + 4}" font-size="12" text-anchor="middle">${number}</text></g>`;
    })
    .join("");
  const height = Math.max(850, 700 + layout.objects.length * 20);
  const legend = layout.objects
    .map(
      (o, i) =>
        `<text x="30" y="${670 + i * 20}" font-size="14">${i + 1}. ${esc(o.name.slice(0, 75))} — ${o.width} W × ${o.depth} D × ${o.height} H in; ${o.quarterTurns * 90}°${Object.values(o.evidence).some((e) => e.basis === "assumption") ? " · assumptions remain" : ""}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}"><rect width="1000" height="${height}" fill="#faf8f4"/><g font-family="Arial" fill="#292621"><text x="30" y="30" font-size="22">${view.toUpperCase()} — SOURCE-LINKED ENVELOPE MODEL</text><text x="30" y="55" font-size="13">Inches. Amber = assumptions; green = access zone. Representative shapes; not construction verification.</text>${shapes}<text x="30" y="640" font-size="15">OBJECT ENVELOPES — local width × depth × height</text>${legend}</g></svg>`;
}

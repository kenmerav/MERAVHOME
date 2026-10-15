import { useEffect, useRef, useState } from "react";
import type { SavedCodexLayout } from "@/lib/codexRenderingLayout";

export function CodexLayoutPreview({ saved }: { saved: SavedCodexLayout }) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"angled" | "plan" | "front">("angled"),
    [error, setError] = useState("");
  useEffect(() => {
    let disposed = false,
      cleanup = () => {};
    void (async () => {
      const [T, { OrbitControls }, { codexLayoutModel }] = await Promise.all([
        import("three"),
        import("three/addons/controls/OrbitControls.js"),
        import("@/lib/codexLayoutModel"),
      ]);
      if (disposed || !host.current) return;
      const node = host.current,
        e = saved.layout.extent,
        span = Math.max(e.width, e.height, e.depth),
        scene = new T.Scene();
      scene.background = new T.Color("#f8f5ef");
      const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      node.appendChild(renderer.domElement);
      const camera = new T.OrthographicCamera(-span, span, span, -span, 0.1, span * 20);
      const target = new T.Vector3(e.width / 2, e.height / 3, e.depth / 2);
      camera.position
        .copy(target)
        .add(
          view === "plan"
            ? new T.Vector3(0, span * 3, 0.001)
            : view === "front"
              ? new T.Vector3(0, 0, span * 3)
              : new T.Vector3(-span * 1.1, span * 0.8, span * 2),
        );
      if (view === "plan") camera.up.set(0, 0, -1);
      camera.lookAt(target);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(target);
      controls.enableDamping = true;
      scene.add(codexLayoutModel(saved.layout), new T.HemisphereLight(0xffffff, 0x8b8171, 2));
      const light = new T.DirectionalLight(0xffffff, 2);
      light.position.set(-100, 200, 200);
      scene.add(light);
      const resize = () => {
        const w = Math.max(1, node.clientWidth),
          h = 360;
        renderer.setSize(w, h);
        const halfHeight =
          view === "plan"
            ? Math.max(e.depth, e.width / (w / h)) * 0.6
            : view === "front"
              ? Math.max(e.height, e.width / (w / h)) * 0.55
              : span * 0.55;
        camera.left = (-halfHeight * w) / h;
        camera.right = (halfHeight * w) / h;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(node);
      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
      });
      cleanup = () => {
        observer.disconnect();
        renderer.setAnimationLoop(null);
        controls.dispose();
        scene.traverse((o) => {
          if (o instanceof T.Mesh || o instanceof T.LineSegments) {
            o.geometry.dispose();
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => m.dispose());
          }
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
      if (disposed) cleanup();
    })().catch(() =>
      setError(
        "3D preview unavailable on this device. Download the layout and guides to review it.",
      ),
    );
    return () => {
      disposed = true;
      cleanup();
    };
  }, [saved, view]);
  async function download() {
    const [{ GLTFExporter }, { codexLayoutModel }] = await Promise.all([
      import("three/addons/exporters/GLTFExporter.js"),
      import("@/lib/codexLayoutModel"),
    ]);
    const model = codexLayoutModel(saved.layout);
    // glTF uses metres. The editing/model evidence coordinates remain inches.
    model.scale.setScalar(0.0254);
    try {
      const result = await new GLTFExporter().parseAsync(model, { binary: true });
      const url = URL.createObjectURL(
        new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${saved.layout.itemId}-layout.glb`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Could not export the model. The saved layout remains available.");
    } finally {
      model.traverse((o: any) => {
        o.geometry?.dispose();
        if (o.material)
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose());
      });
    }
  }
  return (
    <div className="border p-3 mt-3">
      <p className="font-medium">
        {saved.ready
          ? "Layout checks passed — photo still needs review"
          : "Layout needs correction — photo step blocked"}
      </p>
      <div className="flex flex-wrap gap-3 text-sm mt-2">
        {(["angled", "plan", "front"] as const).map((v) => (
          <button
            key={v}
            aria-pressed={view === v}
            className="underline"
            onClick={() => setView(v)}
          >
            {v === "angled" ? "3D view" : v === "plan" ? "Floor plan" : "Elevation"}
          </button>
        ))}
        <button className="underline" onClick={() => void download()}>
          Download 3D model
        </button>
      </div>
      <div ref={host} aria-label="Measured layout 3D preview" className="w-full h-[360px] mt-2" />
      {error && <p role="alert">{error}</p>}
      <p className="text-xs">
        Envelope dimensions in inches. Amber shapes contain assumptions. Drag to rotate. Fixture
        shapes are representative; this checks layout, not construction compliance.
      </p>
      <details className="text-xs mt-2">
        <summary>Dimension sources and layout findings</summary>
        <ul className="list-disc pl-4">
          {saved.checks.map((c, i) => (
            <li key={i}>
              {c.outcome}: {c.evidence}
            </li>
          ))}
        </ul>
        {saved.layout.objects.map((o) => (
          <div className="mt-2" key={o.id}>
            <strong>
              {o.name}: {o.width}″ wide × {o.depth}″ deep × {o.height}″ high
            </strong>
            {Object.entries(o.evidence).map(([axis, e]) => (
              <p key={axis}>
                {axis}: {e.basis} — {e.note}
              </p>
            ))}
          </div>
        ))}
      </details>
    </div>
  );
}

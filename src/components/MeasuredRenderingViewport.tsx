import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { measuredGeometry } from "@/lib/measuredRenderingGeometry";
import type {
  MeasuredElevation,
  RenderReview,
  MeasuredProductModel,
} from "@/lib/measuredRendering";
export function MeasuredRenderingViewport({
  elevation,
  review,
  front,
  models = [],
  captureRef,
  onViewChange,
}: {
  elevation: MeasuredElevation;
  review: RenderReview;
  front: boolean;
  models?: MeasuredProductModel[];
  captureRef?: {
    current:
      | (() => { image: string; camera: { type: string; position: number[]; target: number[] } })
      | null;
  };
  onViewChange?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.domElement.setAttribute("aria-label", "Measured 3D elevation preview");
    el.appendChild(renderer.domElement);
    const world = new THREE.Scene();
    world.background = new THREE.Color("#ebe6df");
    const pmrem = new THREE.PMREMGenerator(renderer),
      environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    world.environment = environment.texture;
    const root = measuredGeometry(elevation, review);
    world.add(root);
    let disposed = false;
    let pendingModels = review.elements.filter((e) =>
      models.some((m) => m.specId === e.specId),
    ).length;
    let modelFailed = false;
    for (const element of review.elements) {
      const model = models.find((m) => m.specId === element.specId);
      if (!model) continue;
      void new GLTFLoader()
        .loadAsync(model.dataUrl)
        .then((gltf) => {
          if (disposed) return;
          const mesh = gltf.scene,
            bounds = new THREE.Box3().setFromObject(mesh),
            span = bounds.getSize(new THREE.Vector3());
          if (Math.min(span.x, span.y, span.z) <= 0) return;
          const scale = new THREE.Vector3(
            element.width / span.x,
            element.height / span.y,
            element.depth / span.z,
          );
          const anchor = new THREE.Group();
          anchor.name = element.id;
          anchor.position.set(element.x, element.y, element.z);
          mesh.scale.copy(scale);
          mesh.position.set(
            (-(bounds.min.x + bounds.max.x) / 2) * scale.x,
            -bounds.min.y * scale.y,
            (-(bounds.min.z + bounds.max.z) / 2) * scale.z,
          );
          mesh.traverse((o: any) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
          anchor.add(mesh);
          const proxy = root.getObjectByName(element.id);
          if (proxy) root.remove(proxy);
          root.add(anchor);
        })
        .catch(() => {
          modelFailed = true;
          /* Invalid files are rejected before import; load errors leave the representative preview. */
        })
        .finally(() => {
          pendingModels--;
        });
    }
    const ambient = new THREE.HemisphereLight(0xfff3e0, 0xb0aaa0, 2);
    world.add(ambient);
    const key = new THREE.DirectionalLight(0xfff1d6, 4);
    key.position.set(-70, elevation.height + 50, 140);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -250;
    key.shadow.camera.right = 250;
    key.shadow.camera.top = 250;
    key.shadow.camera.bottom = -250;
    key.shadow.camera.far = 800;
    key.shadow.normalBias = 0.15;
    world.add(key);
    world.add(key.target);
    key.target.position.set(elevation.width / 2, elevation.height / 2, 0);
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const w = elevation.width,
      h = elevation.height;
    if (front) {
      camera = new THREE.OrthographicCamera(-w * 0.6, w * 0.6, h * 0.65, -h * 0.65, 0.01, 3000);
      camera.position.set(w / 2, h / 2, 500);
    } else {
      camera = new THREE.PerspectiveCamera(43, 1, 0.01, 3000);
      camera.position.set(w * 0.23, h * 0.53, w * 1.25);
    }
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(w / 2, h * 0.46, 0);
    controls.enableDamping = true;
    controls.enableRotate = !front;
    controls.update();
    if (onViewChange) controls.addEventListener("start", onViewChange);
    if (captureRef)
      captureRef.current = () => {
        if (pendingModels) throw new Error("Wait for the product models to load.");
        if (modelFailed)
          throw new Error(
            "A product model could not load. Remove or replace it before saving the camera view.",
          );
        const size = renderer.getSize(new THREE.Vector2()),
          pixelRatio = renderer.getPixelRatio();
        const oldProjection = camera.projectionMatrix.clone();
        const savedCamera = camera.clone();
        const aspect = 1600 / 1088;
        if (camera instanceof THREE.PerspectiveCamera) camera.aspect = aspect;
        else {
          const span = Math.max(h * 1.25, (w / aspect) * 1.25);
          camera.top = span / 2;
          camera.bottom = -span / 2;
          camera.left = (-span * aspect) / 2;
          camera.right = (span * aspect) / 2;
        }
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(1);
        renderer.setSize(1600, 1088, false);
        renderer.render(world, camera);
        const image = renderer.domElement.toDataURL("image/png");
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(size.x, size.y, false);
        camera.projectionMatrix.copy(oldProjection);
        camera.projectionMatrixInverse.copy(oldProjection).invert();
        camera.copy(savedCamera as any);
        return {
          image,
          camera: {
            type: front ? "elevation" : "perspective",
            position: camera.position.toArray(),
            target: controls.target.toArray(),
          },
        };
      };
    let frame = 0;
    const render = () => {
      controls.update();
      renderer.render(world, camera);
      frame = requestAnimationFrame(render);
    };
    const resize = new ResizeObserver(() => {
      const width = el.clientWidth,
        height = el.clientHeight;
      renderer.setSize(width, height);
      const aspect = width / height;
      if (camera instanceof THREE.PerspectiveCamera) camera.aspect = aspect;
      else {
        const span = Math.max(h * 1.25, (w / aspect) * 1.25);
        camera.top = span / 2;
        camera.bottom = -span / 2;
        camera.left = (-span * aspect) / 2;
        camera.right = (span * aspect) / 2;
      }
      camera.updateProjectionMatrix();
    });
    resize.observe(el);
    render();
    return () => {
      disposed = true;
      if (captureRef) captureRef.current = null;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      root.traverse((o: any) => {
        o.geometry?.dispose();
        o.material?.dispose?.();
      });
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [elevation, review, front, models]);
  return <div ref={host} className="h-[520px] w-full border border-border bg-bone" />;
}

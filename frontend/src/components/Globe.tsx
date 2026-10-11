import { useEffect, useRef } from "react";
import * as THREE from "three";
import { gstime } from "satellite.js";
import type { SatelliteRecord } from "../types/satellite";
import {
  computeOrbitTrail,
  geodeticToVector3,
  propagatePosition,
} from "../lib/propagation";
import { useUiStore } from "../store/satellites";
import { createEarthTexture, createLabelSprite } from "../lib/earthTexture";

interface GlobeProps {
  satellites: SatelliteRecord[];
  visibleSatellites: SatelliteRecord[];
}

const EARTH_RADIUS = 1; // scene units
// Left search panel width incl. margin; on wide screens the globe is centred beside it.
const SIDE_PANEL_PX = 340;
// Globe diameter as a fraction of the free viewport area.
const GLOBE_FILL = 0.72;
// Default view faces Mumbai: spin its longitude to the camera, then tilt its latitude to centre.
const HOME_LAT = 19.076;
const HOME_LON = 72.8777;
const HOME_ROT_X = THREE.MathUtils.degToRad(HOME_LAT);
const HOME_ROT_Y = -Math.PI / 2 - THREE.MathUtils.degToRad(HOME_LON);

const CONTINENTS = [
  { name: "North America", lat: 50, lon: -103 },
  { name: "South America", lat: -20, lon: -62 },
  { name: "Europe", lat: 54, lon: 18 },
  { name: "Africa", lat: 4, lon: 20 },
  { name: "Asia", lat: 45, lon: 88 },
  { name: "Oceania", lat: -28, lon: 136 },
  { name: "Antarctica", lat: -78, lon: 30 },
];

export function Globe({ satellites, visibleSatellites }: GlobeProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(visibleSatellites);
  const allRef = useRef(satellites);

  useEffect(() => {
    visibleRef.current = visibleSatellites;
  }, [visibleSatellites]);

  useEffect(() => {
    allRef.current = satellites;
  }, [satellites]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.01,
      100
    );
    camera.position.set(0, 0, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight, false);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // Earth with custom day/night terminator shader.
    // Sun direction uniform is updated each frame from solar position.
    const earthGeom = new THREE.SphereGeometry(EARTH_RADIUS, 96, 96);
    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        // Earth-fixed frame (same axes as geodeticToVector3), so drag rotation can't move the terminator.
        uSunDir: { value: new THREE.Vector3(1, 0.3, 0.5).normalize() },
        uMap: { value: null as THREE.Texture | null },
        uHasMap: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec2 vUv;
        void main() {
          vNormal = normal;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform sampler2D uMap;
        uniform float uHasMap;
        varying vec3 vNormal;
        varying vec2 vUv;
        void main() {
          float sunDot = dot(normalize(vNormal), normalize(uSunDir));
          // Smooth terminator band: ±4° in angular terms (~0.07 radians)
          float t = smoothstep(-0.07, 0.07, sunDot);
          vec3 dayColor = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : vec3(0.09, 0.25, 0.52);
          // Night side stays dim but legible so countries remain visible.
          vec3 nightColor = dayColor * 0.32 + vec3(0.0, 0.01, 0.03);
          gl_FragColor = vec4(mix(nightColor, dayColor, t), 1.0);
        }
      `,
    });
    const earth = new THREE.Mesh(earthGeom, earthMat);
    scene.add(earth);

    // Country map loads asynchronously; the plain ocean shader shows until it's ready.
    let disposed = false;
    createEarthTexture(renderer.capabilities.maxTextureSize)
      .then((tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        earthMat.uniforms.uMap.value = tex;
        earthMat.uniforms.uHasMap.value = 1;
      })
      .catch(() => {
        // keep the plain-ocean fallback
      });

    const continentLabels = CONTINENTS.map(({ name, lat, lon }) => {
      const sprite = createLabelSprite(name);
      const v = geodeticToVector3(lat, lon, 250, EARTH_RADIUS);
      sprite.position.set(v.x, v.y, v.z);
      return sprite;
    });

    // Subtle atmosphere — back-side sphere with additive blending.
    const atmoGeom = new THREE.SphereGeometry(EARTH_RADIUS * 1.06, 64, 64);
    const atmoMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
          gl_FragColor = vec4(0.36, 0.78, 1.0, 1.0) * intensity;
        }
      `,
    });
    const atmo = new THREE.Mesh(atmoGeom, atmoMat);
    scene.add(atmo);

    // Stars — point cloud.
    const starGeom = new THREE.BufferGeometry();
    const starCount = 4500;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const r = 30 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    starGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.08,
      color: 0xffffff,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
    });
    scene.add(new THREE.Points(starGeom, starMat));

    // Directional light tracks the computed solar position for satellite marker shading.
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.4);
    scene.add(sun);
    const fill = new THREE.AmbientLight(0x223355, 0.35);
    scene.add(fill);

    // Equator and graticule lines for orientation.
    const equatorGeom = new THREE.BufferGeometry();
    const equatorPts: number[] = [];
    for (let i = 0; i <= 128; i += 1) {
      const a = (i / 128) * Math.PI * 2;
      equatorPts.push(
        Math.cos(a) * EARTH_RADIUS * 1.001,
        0,
        -Math.sin(a) * EARTH_RADIUS * 1.001
      );
    }
    equatorGeom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(equatorPts, 3)
    );
    const equator = new THREE.LineLoop(
      equatorGeom,
      new THREE.LineBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.18 })
    );
    scene.add(equator);

    // Satellites — InstancedMesh of small spheres for performance.
    const satGeom = new THREE.SphereGeometry(0.005, 8, 8);
    const satMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const maxInstances = 4000;
    const instanced = new THREE.InstancedMesh(satGeom, satMat, maxInstances);
    instanced.count = 0;
    instanced.frustumCulled = false;
    instanced.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxInstances * 3),
      3
    );
    scene.add(instanced);

    // Orbit trail line (for selected satellite only).
    const orbitGeom = new THREE.BufferGeometry();
    orbitGeom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(360), 3)
    );
    const orbitMat = new THREE.LineBasicMaterial({
      color: 0x5ce1ff,
      transparent: true,
      opacity: 0.85,
    });
    const orbitLine = new THREE.Line(orbitGeom, orbitMat);
    orbitLine.visible = false;
    scene.add(orbitLine);

    // Ground track — sub-satellite path projected onto Earth surface.
    const groundTrackMat = new THREE.LineBasicMaterial({
      color: 0xffb547,
      transparent: true,
      opacity: 0.5,
    });
    const groundTrackLine = new THREE.Line(
      new THREE.BufferGeometry(),
      groundTrackMat
    );
    groundTrackLine.visible = false;
    scene.add(groundTrackLine);

    // Selected satellite highlight — pulsing ring.
    const ringGeom = new THREE.RingGeometry(0.018, 0.024, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb547,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.visible = false;
    scene.add(ring);

    // ---- Interaction: trackball-style drag rotation + zoom ----
    let isDragging = false;
    let dragMoved = false;
    let lastX = 0;
    let lastY = 0;
    const sceneRotation = new THREE.Group();
    scene.add(sceneRotation);
    sceneRotation.add(earth, atmo, equator, instanced, orbitLine, groundTrackLine, ring, ...continentLabels);
    sceneRotation.rotation.set(HOME_ROT_X, HOME_ROT_Y, 0);

    // ---- View fitting + pan (screen-space offset) + zoom ----
    const view = { panX: 0, panY: 0, zoom: 1, baseDistance: 3 };
    const applyView = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      const sideInset = w >= 768 ? SIDE_PANEL_PX : 0;
      // Distance at which the globe's diameter covers GLOBE_FILL of the free area.
      const fraction = (GLOBE_FILL * Math.min(h, w - sideInset)) / h;
      const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      view.baseDistance = Math.sqrt(1 + (1 / (fraction * tanHalfFov)) ** 2);
      camera.position.set(0, 0, view.baseDistance * view.zoom);
      camera.lookAt(0, 0, 0);
      camera.aspect = w / h;
      camera.setViewOffset(w, h, -(sideInset / 2 + view.panX), -view.panY, w, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    const resetView = () => {
      view.panX = 0;
      view.panY = 0;
      view.zoom = 1;
      sceneRotation.rotation.set(HOME_ROT_X, HOME_ROT_Y, 0);
      applyView();
    };
    const updateCursor = () => {
      const pan = useUiStore.getState().panMode;
      renderer.domElement.style.cursor = pan ? (isDragging ? "grabbing" : "move") : "grab";
    };
    applyView();

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      dragMoved = false;
      lastX = e.clientX;
      lastY = e.clientY;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      updateCursor();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
      if (useUiStore.getState().panMode) {
        view.panX += dx;
        view.panY += dy;
        applyView();
        return;
      }
      sceneRotation.rotation.y += dx * 0.005;
      sceneRotation.rotation.x = THREE.MathUtils.clamp(
        sceneRotation.rotation.x + dy * 0.005,
        -Math.PI / 2 + 0.05,
        Math.PI / 2 - 0.05
      );
    };
    const onPointerUp = (e: PointerEvent) => {
      const wasClick = isDragging && !dragMoved;
      isDragging = false;
      updateCursor();
      if (wasClick) handleClick(e);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = view.zoom * (1 + e.deltaY * 0.001);
      view.zoom = THREE.MathUtils.clamp(next, 1.25 / view.baseDistance, 12 / view.baseDistance);
      applyView();
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.02 };
    const ndc = new THREE.Vector2();

    const handleClick = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      // Find nearest visible satellite by screen-space distance to its instance.
      const visible = visibleRef.current;
      const positions = positionsRef;
      const matrix = new THREE.Matrix4();
      let bestIdx = -1;
      let bestDist = Infinity;
      const tmpVec = new THREE.Vector3();
      for (let i = 0; i < positions.length; i += 1) {
        matrix.copy(positions[i]);
        tmpVec.setFromMatrixPosition(matrix);
        tmpVec.applyMatrix4(sceneRotation.matrixWorld);
        // Project to NDC and measure 2D distance.
        const projected = tmpVec.clone().project(camera);
        const dx = projected.x - ndc.x;
        const dy = projected.y - ndc.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestDist < 0.0008 && visible[bestIdx]) {
        useUiStore.getState().selectSatellite(visible[bestIdx].noradId);
      }
    };

    // Per-frame caches.
    const positionsRef: THREE.Matrix4[] = [];
    const tmpMatrix = new THREE.Matrix4();
    const tmpColor = new THREE.Color();
    const tmpLabelPos = new THREE.Vector3();
    const CATEGORY_COLOR: Record<string, number> = {
      iss: 0xffb547,
      "earth-observation": 0x5ce1ff,
      weather: 0x6affc6,
      communication: 0xff7eb6,
      science: 0xb888ff,
      navigation: 0xffd166,
      cubesat: 0xbef264,
      other: 0xa0adc7,
    };

    let lastSelected = -1;
    let lastOrbitNorad = -1;
    let lastGroundTrackNorad = -1;

    const clock = new THREE.Clock();
    let frameId = 0;

    const animate = () => {
      const dt = clock.getDelta();
      if (!isDragging && useUiStore.getState().autoRotate) {
        sceneRotation.rotation.y += dt * 0.02;
      }

      // Update solar position — approximate Sun direction in ECI, mapped to scene Y-up coords.
      // d = days since J2000.5; formula accurate to ~1°.
      const now = new Date();
      const d = now.getTime() / 86_400_000 - 10957.5;
      const g = ((357.529 + 0.98560028 * d) % 360) * (Math.PI / 180);
      const L = ((280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360) * (Math.PI / 180);
      const e = (23.439 - 0.0000004 * d) * (Math.PI / 180);
      const sx = Math.cos(L);
      const sy_eci = Math.sin(L) * Math.cos(e);
      const sz_eci = Math.sin(L) * Math.sin(e);
      // ECI → Earth-fixed (rotate by sidereal time), then to scene Y-up: (x, z, -y).
      const gmst = gstime(now);
      const sxEcf = Math.cos(gmst) * sx + Math.sin(gmst) * sy_eci;
      const syEcf = -Math.sin(gmst) * sx + Math.cos(gmst) * sy_eci;
      const sunDir = new THREE.Vector3(sxEcf, sz_eci, -syEcf).normalize();
      earthMat.uniforms.uSunDir.value = sunDir;
      sun.position.copy(sunDir.clone().applyQuaternion(sceneRotation.quaternion).multiplyScalar(10));

      // Continent names fade out when zoomed in close enough to read country names.
      // Labels also fade towards the limb and hide on the far side of the globe.
      const zoomOpacity = THREE.MathUtils.clamp((camera.position.z - 1.8) / 1.0, 0, 1) * 0.95;
      sceneRotation.updateMatrixWorld();
      for (const label of continentLabels) {
        tmpLabelPos.copy(label.position).applyMatrix4(sceneRotation.matrixWorld).normalize();
        const facing = THREE.MathUtils.smoothstep(tmpLabelPos.z, 0.2, 0.45);
        label.material.opacity = zoomOpacity * facing;
        label.visible = label.material.opacity > 0.01;
      }
      const visible = visibleRef.current;
      positionsRef.length = 0;
      const colorAttr = instanced.instanceColor!;

      for (let i = 0; i < visible.length && i < maxInstances; i += 1) {
        const sat = visible[i];
        const p = propagatePosition(sat, now);
        if (!p) {
          tmpMatrix.makeScale(0, 0, 0);
        } else {
          const v = geodeticToVector3(
            p.latitudeDeg,
            p.longitudeDeg,
            p.altitudeKm,
            EARTH_RADIUS
          );
          tmpMatrix.makeTranslation(v.x, v.y, v.z);
        }
        instanced.setMatrixAt(i, tmpMatrix);
        positionsRef.push(tmpMatrix.clone());
        const c = CATEGORY_COLOR[sat.category] ?? CATEGORY_COLOR.other;
        tmpColor.setHex(c);
        colorAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
      }
      instanced.count = Math.min(visible.length, maxInstances);
      instanced.instanceMatrix.needsUpdate = true;
      colorAttr.needsUpdate = true;

      // Update selected satellite highlight + orbit trail.
      const selectedNorad = useUiStore.getState().selectedNoradId;
      const showTrail = useUiStore.getState().showOrbitTrail;
      if (selectedNorad !== lastSelected) {
        lastSelected = selectedNorad ?? -1;
      }
      if (selectedNorad != null) {
        const idx = visible.findIndex((s) => s.noradId === selectedNorad);
        if (idx >= 0) {
          const m = positionsRef[idx];
          if (m) {
            const pos = new THREE.Vector3().setFromMatrixPosition(m);
            ring.position.copy(pos);
            ring.lookAt(0, 0, 0);
            ring.visible = true;
            const pulse = 1 + Math.sin(performance.now() * 0.005) * 0.15;
            ring.scale.setScalar(pulse);
          }
        }

        if (showTrail && selectedNorad !== lastOrbitNorad) {
          const sat = allRef.current.find((s) => s.noradId === selectedNorad);
          if (sat) {
            const trail = computeOrbitTrail(sat, now, 180);
            const arr = new Float32Array(trail.length * 3);
            for (let i = 0; i < trail.length; i += 1) {
              const v = geodeticToVector3(
                trail[i].latitudeDeg,
                trail[i].longitudeDeg,
                trail[i].altitudeKm,
                EARTH_RADIUS
              );
              arr[i * 3] = v.x;
              arr[i * 3 + 1] = v.y;
              arr[i * 3 + 2] = v.z;
            }
            orbitLine.geometry.dispose();
            orbitLine.geometry = new THREE.BufferGeometry();
            orbitLine.geometry.setAttribute(
              "position",
              new THREE.Float32BufferAttribute(arr, 3)
            );
            orbitLine.visible = trail.length > 0;
          }
          lastOrbitNorad = selectedNorad;
        } else if (!showTrail) {
          orbitLine.visible = false;
        }

        // Ground track — recompute when selection changes.
        if (selectedNorad !== lastGroundTrackNorad) {
          const sat = allRef.current.find((s) => s.noradId === selectedNorad);
          if (sat) {
            const trail = computeOrbitTrail(sat, now, 180);
            const arr = new Float32Array(trail.length * 3);
            for (let i = 0; i < trail.length; i += 1) {
              // Project to Earth surface (altitude = 0.002 to avoid z-fighting).
              const v = geodeticToVector3(
                trail[i].latitudeDeg,
                trail[i].longitudeDeg,
                0.002 * EARTH_RADIUS * 6371,
                EARTH_RADIUS
              );
              arr[i * 3] = v.x;
              arr[i * 3 + 1] = v.y;
              arr[i * 3 + 2] = v.z;
            }
            groundTrackLine.geometry.dispose();
            groundTrackLine.geometry = new THREE.BufferGeometry();
            groundTrackLine.geometry.setAttribute(
              "position",
              new THREE.Float32BufferAttribute(arr, 3)
            );
            groundTrackLine.visible = trail.length > 0;
          }
          lastGroundTrackNorad = selectedNorad;
        }
      } else {
        ring.visible = false;
        orbitLine.visible = false;
        groundTrackLine.visible = false;
        lastOrbitNorad = -1;
        lastGroundTrackNorad = -1;
      }

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    const ro = new ResizeObserver(applyView);
    ro.observe(mount);

    updateCursor();
    const unsubscribe = useUiStore.subscribe((state, prev) => {
      if (state.viewResetToken !== prev.viewResetToken) resetView();
      if (state.panMode !== prev.panMode) updateCursor();
    });

    return () => {
      disposed = true;
      unsubscribe();
      cancelAnimationFrame(frameId);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      earthGeom.dispose();
      earthMat.dispose();
      atmoGeom.dispose();
      atmoMat.dispose();
      satGeom.dispose();
      satMat.dispose();
      orbitGeom.dispose();
      orbitMat.dispose();
      groundTrackLine.geometry.dispose();
      groundTrackMat.dispose();
      ringGeom.dispose();
      ringMat.dispose();
      earthMat.uniforms.uMap.value?.dispose();
      for (const label of continentLabels) {
        label.material.map?.dispose();
        label.material.dispose();
      }
    };
    // We intentionally run this effect once and read latest data via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="absolute inset-0" />;
}

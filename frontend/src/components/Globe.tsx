import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { SatelliteRecord } from "../types/satellite";
import {
  computeOrbitTrail,
  geodeticToVector3,
  propagatePosition,
} from "../lib/propagation";
import { useUiStore } from "../store/satellites";

interface GlobeProps {
  satellites: SatelliteRecord[];
  visibleSatellites: SatelliteRecord[];
}

const EARTH_RADIUS = 1; // scene units

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
    camera.position.set(0, 0.6, 3);

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
        uSunDir: { value: new THREE.Vector3(1, 0.3, 0.5).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldNormal;
        void main() {
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        varying vec3 vWorldNormal;
        void main() {
          float sunDot = dot(normalize(vWorldNormal), normalize(uSunDir));
          // Smooth terminator band: ±4° in angular terms (~0.07 radians)
          float t = smoothstep(-0.07, 0.07, sunDot);
          vec3 dayColor   = vec3(0.09, 0.25, 0.52);
          vec3 nightColor = vec3(0.015, 0.03, 0.09);
          gl_FragColor = vec4(mix(nightColor, dayColor, t), 1.0);
        }
      `,
    });
    const earth = new THREE.Mesh(earthGeom, earthMat);
    scene.add(earth);

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
    sceneRotation.add(earth, atmo, equator, instanced, orbitLine, groundTrackLine, ring);

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      dragMoved = false;
      lastX = e.clientX;
      lastY = e.clientY;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
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
      if (wasClick) handleClick(e);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = camera.position.length() * (1 + e.deltaY * 0.001);
      const clamped = THREE.MathUtils.clamp(next, 1.4, 8);
      camera.position.setLength(clamped);
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
      if (!isDragging) sceneRotation.rotation.y += dt * 0.02;

      // Update solar position — approximate Sun direction in ECI, mapped to scene Y-up coords.
      // d = days since J2000.5; formula accurate to ~1°.
      const now = new Date();
      const d = now.getTime() / 86_400_000 - 10957.5;
      const g = ((357.529 + 0.98560028 * d) % 360) * (Math.PI / 180);
      const L = ((280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360) * (Math.PI / 180);
      const e = (23.439 - 0.0000004 * d) * (Math.PI / 180);
      // ECI unit vector → scene Y-up: (x_eci, z_eci, -y_eci)
      const sx = Math.cos(L);
      const sy_eci = Math.sin(L) * Math.cos(e);
      const sz_eci = Math.sin(L) * Math.sin(e);
      const sunDir = new THREE.Vector3(sx, sz_eci, -sy_eci).normalize();
      (earthMat.uniforms as Record<string, { value: unknown }>).uSunDir.value = sunDir;
      sun.position.copy(sunDir.clone().multiplyScalar(10));
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

    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
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
    };
    // We intentionally run this effect once and read latest data via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="absolute inset-0" />;
}

import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

// ---------- basis ----------
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 0.6, 7);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2.2;
controls.maxDistance = 7;
controls.target.set(0, 0.15, 0);

// ---------- post-processing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.3, // sterkte
  0.5, // radius
  3.0, // drempel: de HDR is fel, dus alleen echte highlights (lampen, chrome glans) gloeien
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// filmische afwerking: subtiele chromatische aberratie, vignet en korrel
const finishPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;

    void main() {
      vec2 d = vUv - 0.5;
      float r = dot(d, d);

      // chromatische aberratie, sterker aan de randen
      vec2 offset = d * r * 0.012;
      vec3 color;
      color.r = texture2D(tDiffuse, vUv + offset).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - offset).b;

      // koel vignet
      float vignette = smoothstep(0.15, 0.75, r * 2.0);
      color = mix(color, color * vec3(0.78, 0.83, 0.92), vignette);

      // filmkorrel
      float grain = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      color += (grain - 0.5) * 0.03;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
composer.addPass(finishPass);

// ---------- laden ----------
const loaderEl = document.querySelector(".loader-percent");
const manager = new THREE.LoadingManager();
let loadedAt = null;

manager.onProgress = (url, loaded, total) => {
  loaderEl.textContent = `${Math.round((loaded / total) * 100)}%`;
};
manager.onLoad = () => {
  loaderEl.textContent = "100%";
  document.body.classList.add("loaded");
  loadedAt = performance.now();
};

const hdrLoader = new HDRLoader(manager);
const gltfLoader = new GLTFLoader(manager);
const textureLoader = new THREE.TextureLoader(manager);

hdrLoader.load("/textures/bubble_studio.hdr", (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = texture;
  scene.environment = texture;
});

// ---------- morph (vertex shader) ----------
const morphUniforms = {
  uTime: { value: 0 },
  uMorph: { value: 0 },
};
let morphTarget = 0;

function enableMorph(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = morphUniforms.uTime;
    shader.uniforms.uMorph = morphUniforms.uMorph;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uMorph;")
      .replace(
        "#include <project_vertex>",
        `vec4 morphWorld = modelMatrix * vec4(transformed, 1.0);
        vec3 morphNormal = mat3(modelMatrix) * normal;
        float morphNormalLength = length(morphNormal);
        morphNormal = morphNormalLength > 0.0001 ? morphNormal / morphNormalLength : vec3(0.0);
        float wobble =
          sin(morphWorld.x * 3.0 + uTime) * 0.5 +
          sin(morphWorld.y * 4.0 + uTime * 1.3) * 0.4 +
          sin(morphWorld.z * 5.0 + uTime * 0.7) * 0.3;
        morphWorld.xyz += morphNormal * wobble * 0.09 * uMorph;
        vec4 mvPosition = viewMatrix * morphWorld;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  material.customProgramCacheKey = () => "morph";
  material.needsUpdate = true;
}

// ---------- materialen ----------
function metalMaterial(path) {
  const texture = textureLoader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    metalness: 1,
    roughness: 0.15,
  });
  enableMorph(material);
  return material;
}

const materials = {
  zwart: metalMaterial("/textures/metal_black.png"),
  zilver: metalMaterial("/textures/metal_chrome.png"),
  goud: metalMaterial("/textures/metal_gold.png"),
  // exact hetzelfde materiaal als de blobs: pure spiegelende chrome, zonder texture
  vloeibaar: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.05,
  }),
};
enableMorph(materials.vloeibaar);

const materialInfo = {
  origineel: { specs: "3D scan · originele textures", blob: 0xffffff },
  zwart: { specs: "black chrome · metalness 1.0 · roughness 0.15", blob: 0x1c1e23 },
  zilver: { specs: "liquid chrome · metalness 1.0 · roughness 0.15", blob: 0xffffff },
  goud: { specs: "molten gold · metalness 1.0 · roughness 0.15", blob: 0xd99a2b },
  vloeibaar: { specs: "blob chrome · metalness 1.0 · roughness 0.05", blob: 0xffffff },
};
const materialOrder = ["origineel", "zwart", "zilver", "goud", "vloeibaar"];

// ---------- chrome blobs ----------
const blobMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  metalness: 1,
  roughness: 0.05,
});
const blobTargetColor = new THREE.Color(0xffffff);

const blobs = [];
const blobCount = 9;

for (let i = 0; i < blobCount; i++) {
  const radius = THREE.MathUtils.randFloat(0.25, 0.7);
  const geometry = new THREE.SphereGeometry(radius, 64, 48);
  const blob = new THREE.Mesh(geometry, blobMaterial);

  // verspreid in een halve cirkel achter en naast het hoofd
  const angle = Math.PI + ((i + 0.5) / blobCount) * Math.PI;
  const distance = THREE.MathUtils.randFloat(2.5, 4.5);
  blob.position.set(
    Math.cos(angle) * distance,
    THREE.MathUtils.randFloat(-1.6, 1.6),
    Math.sin(angle) * distance,
  );

  blob.userData = {
    basePositions: geometry.attributes.position.array.slice(),
    startPosition: blob.position.clone(),
    seed: Math.random() * 100,
    speed: THREE.MathUtils.randFloat(0.6, 1.2),
  };

  scene.add(blob);
  blobs.push(blob);
}

const vertex = new THREE.Vector3();

function updateBlobs(t) {
  for (const blob of blobs) {
    const { basePositions, startPosition, seed, speed } = blob.userData;
    const positions = blob.geometry.attributes.position;
    const time = t * speed + seed;

    for (let i = 0; i < positions.count; i++) {
      vertex.fromArray(basePositions, i * 3);
      const n = vertex.clone().normalize();
      const wobble =
        Math.sin(n.x * 3 + time) * 0.12 +
        Math.sin(n.y * 4 + time * 1.3) * 0.1 +
        Math.sin(n.z * 5 + time * 0.7) * 0.08;
      vertex.multiplyScalar(1 + wobble);
      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    positions.needsUpdate = true;
    blob.geometry.computeVertexNormals();

    blob.position.y = startPosition.y + Math.sin(time * 0.8) * 0.25;
    blob.position.x = startPosition.x + Math.cos(time * 0.5) * 0.15;
    blob.rotation.x = time * 0.2;
    blob.rotation.y = time * 0.3;
  }

  // blobs kleuren zacht mee met het gekozen materiaal
  blobMaterial.color.lerp(blobTargetColor, 0.04);
}

// ---------- chrome stofdeeltjes ----------
function makeDotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(200,225,255,0.8)");
  gradient.addColorStop(1, "rgba(200,225,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const dustCount = 700;
const dustPositions = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  const r = THREE.MathUtils.randFloat(2, 8);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
  dustPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  dustPositions[i * 3 + 1] = r * Math.cos(phi) * 0.6;
  dustPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
}
const dustGeometry = new THREE.BufferGeometry();
dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
const dust = new THREE.Points(
  dustGeometry,
  new THREE.PointsMaterial({
    size: 0.05,
    map: makeDotTexture(),
    transparent: true,
    depthWrite: false,
  }),
);
scene.add(dust);

// ---------- zachte schaduw onder het hoofd ----------
function makeShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(25,35,60,0.55)");
  gradient.addColorStop(1, "rgba(25,35,60,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(2.6, 2.6),
  new THREE.MeshBasicMaterial({
    map: makeShadowTexture(),
    transparent: true,
    depthWrite: false,
  }),
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = -1.45;
scene.add(shadow);

// ---------- hoofd + kroon ----------
const headPivot = new THREE.Group();
headPivot.scale.setScalar(0);
scene.add(headPivot);

const crownPivot = new THREE.Group();
headPivot.add(crownPivot);

const morphMeshes = [];
let currentMaterial = "origineel";
let popAt = -Infinity;

function applyMaterial(mesh) {
  mesh.material =
    currentMaterial === "origineel" ? mesh.userData.originalMaterial : materials[currentMaterial];
}

function prepareMesh(child) {
  // de scan heeft geen normalen, die zijn nodig om te kunnen morphen
  if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
  child.userData.originalMaterial = child.material;
  enableMorph(child.material);
  morphMeshes.push(child);
  applyMaterial(child);
}

function fitAndCenter(object, size) {
  const box = new THREE.Box3().setFromObject(object);
  const dimensions = box.getSize(new THREE.Vector3());
  object.scale.setScalar(size(dimensions));
  const center = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
  object.position.sub(center);
}

gltfLoader.load("/textures/head.glb", (gltf) => {
  const head = gltf.scene;
  head.traverse((child) => child.isMesh && prepareMesh(child));
  fitAndCenter(head, (d) => 2 / d.y);
  headPivot.add(head);
});

gltfLoader.load("/textures/chrome-crown.glb", (gltf) => {
  const crown = gltf.scene;
  crown.traverse((child) => child.isMesh && prepareMesh(child));
  fitAndCenter(crown, (d) => 1.2 / Math.max(d.x, d.z));
  crownPivot.add(crown);
});

// ---------- UI ----------
const ui = document.createElement("div");
ui.className = "material-ui";
document.body.appendChild(ui);

const swatches = {
  zwart: "url(/textures/metal_black.png)",
  zilver: "url(/textures/metal_chrome.png)",
  goud: "url(/textures/metal_gold.png)",
};

const buttons = {};
for (const name of materialOrder) {
  const button = document.createElement("button");
  const swatch = document.createElement("span");
  swatch.className = `swatch swatch-${name}`;
  if (swatches[name]) swatch.style.backgroundImage = swatches[name];
  const label = document.createElement("span");
  label.textContent = name;
  button.append(swatch, label);
  button.addEventListener("click", () => setMaterial(name));
  ui.appendChild(button);
  buttons[name] = button;
}

const divider = document.createElement("span");
divider.className = "divider";
ui.appendChild(divider);

const morphButton = document.createElement("button");
morphButton.className = "morph-toggle";
const morphIcon = document.createElement("span");
morphIcon.className = "swatch swatch-morph";
const morphLabel = document.createElement("span");
morphLabel.textContent = "morph";
morphButton.append(morphIcon, morphLabel);
morphButton.addEventListener("click", toggleMorph);
ui.appendChild(morphButton);

const infoEl = document.querySelector(".material-info");
const infoIndex = infoEl.querySelector(".info-index");
const infoName = infoEl.querySelector(".info-name");
const infoSpecs = infoEl.querySelector(".info-specs");

function setMaterial(name) {
  currentMaterial = name;
  morphMeshes.forEach(applyMaterial);
  for (const key in buttons) {
    buttons[key].classList.toggle("active", key === name);
  }

  infoIndex.textContent = `0${materialOrder.indexOf(name) + 1} / 0${materialOrder.length}`;
  infoName.textContent = name;
  infoSpecs.textContent = materialInfo[name].specs;
  infoEl.classList.remove("swap");
  void infoEl.offsetWidth; // animatie opnieuw starten
  infoEl.classList.add("swap");

  blobTargetColor.set(materialInfo[name].blob);
  popAt = performance.now();
}

function toggleMorph() {
  morphTarget = morphTarget === 1 ? 0 : 1;
  morphButton.classList.toggle("active", morphTarget === 1);
}

buttons.origineel.classList.add("active");

window.addEventListener("keydown", (event) => {
  const index = Number(event.key) - 1;
  if (materialOrder[index]) setMaterial(materialOrder[index]);
  if (event.key.toLowerCase() === "m") toggleMorph();
});

// hoofd volgt zacht de muis
const mouse = new THREE.Vector2();
window.addEventListener("pointermove", (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = (event.clientY / window.innerHeight) * 2 - 1;
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- animatie ----------
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
const easeOutBack = (p) => 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2);
let lookX = 0;
let lookY = 0;
let introDone = false;

function animate(time) {
  const t = time / 1000;
  const sinceLoad = loadedAt === null ? -1 : time - loadedAt;

  // camera-intro: van ver weg naar het hoofd toe
  if (!introDone && sinceLoad >= 0) {
    const raw = Math.min(sinceLoad / 2600, 1);
    const p = easeOutCubic(raw);
    camera.position.set(0, 0.6 - p * 0.35, 7 - p * 3.7);
    if (raw === 1) introDone = true;
  }

  // hoofd groeit in beeld
  let scale = 0;
  if (sinceLoad >= 0) scale = easeOutBack(Math.min((sinceLoad - 300) / 1200, 1));
  if (sinceLoad >= 0 && sinceLoad < 300) scale = 0;

  // kleine "pop" bij het wisselen van materiaal
  const sincePop = (time - popAt) / 1000;
  if (sincePop < 0.6) {
    scale *= 1 + Math.sin(sincePop * Math.PI * 3) * 0.06 * (1 - sincePop / 0.6);
  }
  headPivot.scale.setScalar(Math.max(scale, 0));

  // zweven, wiegen en de muis volgen
  lookX += (mouse.x * 0.35 - lookX) * 0.05;
  lookY += (mouse.y * 0.15 - lookY) * 0.05;
  headPivot.position.y = Math.sin(t * 1.2) * 0.08;
  headPivot.rotation.y = Math.sin(t * 0.4) * 0.35 + lookX;
  headPivot.rotation.x = lookY;

  // schaduw wordt kleiner en lichter als het hoofd hoger zweeft
  const lift = headPivot.position.y;
  shadow.scale.setScalar(Math.max(scale, 0) * (1 - lift * 0.8));
  shadow.material.opacity = 0.9 - lift * 2;

  // kroon valt na de intro zacht boven het hoofd en blijft zweven en draaien
  const drop = sinceLoad < 0 ? 0 : easeOutCubic(THREE.MathUtils.clamp((sinceLoad - 1000) / 1400, 0, 1));
  crownPivot.position.y = 1.3 + (1 - drop) * 2 + Math.sin(t * 1.6) * 0.06;
  crownPivot.rotation.y = t * 0.6;
  crownPivot.rotation.z = Math.sin(t * 0.7) * 0.08;
  crownPivot.rotation.x = Math.cos(t * 0.5) * 0.06;

  updateBlobs(t);

  // stof draait langzaam rond
  dust.rotation.y = t * 0.03;
  dust.position.y = Math.sin(t * 0.3) * 0.1;

  // morph zacht aan- en uitvloeien
  morphUniforms.uTime.value = t;
  morphUniforms.uMorph.value += (morphTarget - morphUniforms.uMorph.value) * 0.05;

  finishPass.uniforms.uTime.value = t;

  controls.update();
  composer.render();
}
renderer.setAnimationLoop(animate);

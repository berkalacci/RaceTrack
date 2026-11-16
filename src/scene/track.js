import * as THREE from 'three';
import { buildInstances } from '../core/instancing.js';

// NASCAR Superspeedway Oval Pist Ölçüleri (Tam yarım daire virajlı dev oval)
export const TRACK = {
  centerZ: 10,
  outerW: 114,      // Uzun düzlükler
  outerH: 54,       // Oval genişliği
  trackWidth: 9.5,  // Geniş 3 şeritli NASCAR asfaltı
  cornerRadius: 27, // Tam yarım daire (outerH / 2) oval virajlar
};

TRACK.innerW = TRACK.outerW - 2 * TRACK.trackWidth;
TRACK.innerH = TRACK.outerH - 2 * TRACK.trackWidth;
TRACK.midHalfW = TRACK.outerW * 0.5 - TRACK.trackWidth * 0.5;
TRACK.midHalfH = TRACK.outerH * 0.5 - TRACK.trackWidth * 0.5;
TRACK.midRadius = TRACK.cornerRadius - TRACK.trackWidth * 0.5;

function roundedRectShape(w, h, r) {
  const safeR = Math.min(r, w * 0.499, h * 0.499);
  const shape = new THREE.Shape();
  shape.moveTo(-w * 0.5 + safeR, -h * 0.5);
  shape.lineTo(w * 0.5 - safeR, -h * 0.5);
  shape.absarc(w * 0.5 - safeR, -h * 0.5 + safeR, safeR, -Math.PI * 0.5, 0, false);
  shape.lineTo(w * 0.5, h * 0.5 - safeR);
  shape.absarc(w * 0.5 - safeR, h * 0.5 - safeR, safeR, 0, Math.PI * 0.5, false);
  shape.lineTo(-w * 0.5 + safeR, h * 0.5);
  shape.absarc(-w * 0.5 + safeR, h * 0.5 - safeR, safeR, Math.PI * 0.5, Math.PI, false);
  shape.lineTo(-w * 0.5, -h * 0.5 + safeR);
  shape.absarc(-w * 0.5 + safeR, -h * 0.5 + safeR, safeR, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function buildCenterlinePoints() {
  const points = [];
  const hW = TRACK.midHalfW;
  const hH = TRACK.midHalfH;
  const r = Math.min(TRACK.midRadius, hH - 0.01);
  const centerZ = TRACK.centerZ;
  const straightSamples = 20;
  const arcSamples = 24;

  const pushStraight = (x0, z0, x1, z1) => {
    for (let i = 0; i <= straightSamples; i++) {
      const t = i / straightSamples;
      points.push(new THREE.Vector3(
        THREE.MathUtils.lerp(x0, x1, t),
        0,
        centerZ + THREE.MathUtils.lerp(z0, z1, t)
      ));
    }
  };
  const pushArc = (cx, cz, a0, a1) => {
    for (let i = 1; i <= arcSamples; i++) {
      const a = THREE.MathUtils.lerp(a0, a1, i / arcSamples);
      points.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, centerZ + cz + Math.sin(a) * r));
    }
  };

  // NASCAR yönü: Saat yönünün tersine (Sol virajlar)
  pushStraight(-hW + r, -hH, hW - r, -hH);
  pushArc(hW - r, 0, -Math.PI * 0.5, Math.PI * 0.5);
  pushStraight(hW - r, hH, -hW + r, hH);
  pushArc(-hW + r, 0, Math.PI * 0.5, Math.PI * 1.5);

  return points;
}

export function createTrackCurve() {
  return new THREE.CatmullRomCurve3(buildCenterlinePoints(), true, 'centripetal', 0.2);
}

export function sampleCenterline(curve, count = 160) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = curve.getPointAt(i / count);
    out.push(new THREE.Vector3(p.x, 0, p.z));
  }
  return out;
}

export function buildRacingLine(curve, count = 128, roadWidth = TRACK.trackWidth) {
  const out = [];
  const tangent = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const u = i / count;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, tangent);
    const nx = -tangent.z;
    const nz = tangent.x;
    const offset = Math.sin(u * Math.PI * 2) * roadWidth * 0.12;
    out.push(new THREE.Vector3(p.x + nx * offset, 0, p.z + nz * offset));
  }
  return out;
}

const KERB = {
  width: 0.6,
  height: 0.08,
  cornerThreshold: 0.03,
  pad: 4,
  stripe: 0.9,
};

function buildKerbPlacements(curve) {
  const totalLength = curve.getLength();
  const samples = Math.max(8, Math.round(totalLength / KERB.stripe));
  const step = totalLength / samples;

  const tangent = new THREE.Vector3();
  const headings = new Float64Array(samples);
  const nodes = new Array(samples);

  for (let i = 0; i < samples; i++) {
    const u = i / samples;
    const point = curve.getPointAt(u);
    curve.getTangentAt(u, tangent);
    headings[i] = Math.atan2(tangent.x, tangent.z);
    nodes[i] = { x: point.x, z: point.z, nx: -tangent.z, nz: tangent.x, rotationY: headings[i] };
  }

  const curvature = new Float64Array(samples);
  const inCorner = new Uint8Array(samples);
  for (let i = 0; i < samples; i++) {
    const next = (i + 1) % samples;
    let delta = headings[next] - headings[i];
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    curvature[i] = delta / step;
    if (Math.abs(curvature[i]) > KERB.cornerThreshold) inCorner[i] = 1;
  }

  const mask = new Uint8Array(samples);
  for (let i = 0; i < samples; i++) {
    if (!inCorner[i]) continue;
    for (let k = -KERB.pad; k <= KERB.pad; k++) mask[(i + k + samples) % samples] = 1;
  }

  const offset = TRACK.trackWidth * 0.5 + KERB.width * 0.5 - 0.07;
  const kerbRed = [];
  const kerbWhite = [];

  for (let i = 0; i < samples; i++) {
    if (!mask[i]) continue;
    const node = nodes[i];
    // NASCAR'da bordürler (apron) sadece virajların iç kısmında olur
    const side = -1;
    const lengthScale = Math.max(0.2, 1 + side * curvature[i] * offset);
    const placement = {
      x: node.x + node.nx * side * offset,
      y: KERB.height * 0.5,
      z: node.z + node.nz * side * offset,
      rotationY: node.rotationY,
      scale: { x: 1, y: 1, z: lengthScale },
    };
    (i % 2 === 0 ? kerbRed : kerbWhite).push(placement);
  }

  return { kerbRed, kerbWhite, kerbLength: step };
}

function bevelKerbGeometry(geometry) {
  const position = geometry.attributes.position;
  const halfWidth = KERB.width * 0.5;
  const halfHeight = KERB.height * 0.5;
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) > 0 && position.getX(i) > halfWidth - 1e-4) {
      position.setY(i, -halfHeight + KERB.height * 0.35);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

// --- NASCAR STADYUM TRİBÜNLERİ VE RENKLİ KOLTUKLAR ---
function addNascarGrandstands(group) {
  const tribuneGroup = new THREE.Group();
  tribuneGroup.name = 'nascar-grandstands';

  const seatColors = [0xd32f2f, 0x1976d2, 0xfbc02d, 0x388e3c, 0xffffff]; // Kırmızı, Mavi, Sarı, Yeşil, Beyaz koltuklar
  const rowCount = 14;         // 14 basamaklı dev tribün
  const standLength = 68;      // Tribün uzunluğu
  const baseDistance = TRACK.outerH * 0.5 + 3.2; // Pist dış duvarının hemen arkası

  // Ana Tribün (Start/Finish düzlüğü) ve Karşı Tribün (Backstretch)
  for (const side of [-1, 1]) {
    // 1. Tribün Beton Gövdesi (Eğimli Taban)
    const baseGeo = new THREE.BoxGeometry(standLength, rowCount * 0.65, rowCount * 0.9);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x454a52, roughness: 0.9 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.set(0, (rowCount * 0.65) * 0.45, TRACK.centerZ + side * (baseDistance + (rowCount * 0.45)));
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    tribuneGroup.add(baseMesh);

    // 2. Basamaklı Renkli Koltuk Sıraları
    for (let r = 0; r < rowCount; r++) {
      const seatRowGeo = new THREE.BoxGeometry(standLength - 1, 0.38, 0.55);
      const seatRowMat = new THREE.MeshStandardMaterial({
        color: seatColors[r % seatColors.length],
        roughness: 0.5,
      });
      const seatMesh = new THREE.Mesh(seatRowGeo, seatRowMat);
      const yPos = 0.8 + r * 0.65;
      const zOffset = baseDistance + r * 0.88;
      seatMesh.position.set(0, yPos, TRACK.centerZ + side * zOffset);
      seatMesh.castShadow = true;
      tribuneGroup.add(seatMesh);
    }

    // 3. Stadyum Üst Çatısı ve Aydınlatma Kirişi
    const roofGeo = new THREE.BoxGeometry(standLength + 2, 0.4, rowCount * 0.95);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x22262e, metalness: 0.5, roughness: 0.4 });
    const roofMesh = new THREE.Mesh(roofGeo, roofMat);
    roofMesh.position.set(
      0,
      rowCount * 0.65 + 2.8,
      TRACK.centerZ + side * (baseDistance + rowCount * 0.42)
    );
    tribuneGroup.add(roofMesh);

    // Çatı Taşıyıcı Kolonlar
    for (let x = -standLength * 0.45; x <= standLength * 0.45; x += standLength * 0.3) {
      const pillarGeo = new THREE.CylinderGeometry(0.25, 0.25, rowCount * 0.65 + 3, 8);
      const pillarMesh = new THREE.Mesh(pillarGeo, roofMat);
      pillarMesh.position.set(
        x,
        (rowCount * 0.65 + 3) * 0.5,
        TRACK.centerZ + side * (baseDistance + rowCount * 0.82)
      );
      tribuneGroup.add(pillarMesh);
    }
  }

  group.add(tribuneGroup);
}

export function addTrackMesh(scene, curve, materials) {
  const group = new THREE.Group();
  group.name = 'track';

  // ── Oval NASCAR Asfaltı
  const outer = roundedRectShape(TRACK.outerW, TRACK.outerH, TRACK.cornerRadius);
  const innerR = Math.max(2, TRACK.cornerRadius - TRACK.trackWidth);
  outer.holes.push(roundedRectShape(TRACK.innerW, TRACK.innerH, innerR));
  const roadGeom = new THREE.ShapeGeometry(outer, 64);
  roadGeom.rotateX(-Math.PI * 0.5);
  const road = new THREE.Mesh(roadGeom, materials.road);
  road.position.set(0, 0.012, TRACK.centerZ);
  road.receiveShadow = true;
  road.matrixAutoUpdate = false;
  road.updateMatrix();
  group.add(road);

  // ── İç Saha Çim Alanı (Infield)
  const islandGeom = new THREE.ShapeGeometry(
    roundedRectShape(TRACK.innerW - 0.35, TRACK.innerH - 0.35, Math.max(1.5, innerR - 0.2)),
    32
  );
  islandGeom.rotateX(-Math.PI * 0.5);
  const island = new THREE.Mesh(islandGeom, materials.grassInfield);
  island.position.set(0, 0.014, TRACK.centerZ);
  island.receiveShadow = true;
  island.matrixAutoUpdate = false;
  island.updateMatrix();
  group.add(island);

  // ── NASCAR Çoklu Şerit Çizgileri (3 Şeritli Oval)
  const dashPlacements = [];
  const dashCount = 180;
  const tangent = new THREE.Vector3();
  for (let i = 0; i < dashCount; i += 2) {
    const u = i / dashCount;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, tangent);
    const nx = -tangent.z;
    const nz = tangent.x;
    const rot = Math.atan2(tangent.x, tangent.z);

    // İki adet paralel kesikli şerit çizgisi (3 şerit oluşturur)
for (const laneOffset of [-1.6, 1.6]) {
dashPlacements.push({
x: p.x + nx * laneOffset,
y: 0.03,
z: p.z + nz * laneOffset,
rotationY: rot,
});
}
}
group.add(buildInstances(
new THREE.BoxGeometry(0.16, 0.03, 1.4),
materials.dash,
dashPlacements,
{ name: 'dashes' }
));
// ── Viraj İçi Bordürler
const { kerbRed, kerbWhite, kerbLength } = buildKerbPlacements(curve);
const kerbGeom = new THREE.BoxGeometry(KERB.width, KERB.height, kerbLength);
bevelKerbGeometry(kerbGeom);
group.add(buildInstances(kerbGeom, materials.kerbRed, kerbRed, { name: 'kerb-red' }));
group.add(buildInstances(kerbGeom, materials.kerbWhite, kerbWhite, { name: 'kerb-white' }));
// ── Start / Finish Damalı Çizgi
const finishU = 0.02;
const finishP = curve.getPointAt(finishU);
const finishT = curve.getTangentAt(finishU).normalize();
const finishN = new THREE.Vector3(-finishT.z, 0, finishT.x).normalize();
const tileW = TRACK.trackWidth / 12;
const rotationY = Math.atan2(finishT.x, finishT.z);
const tilesA = [];
const tilesB = [];
for (let i = 0; i < 12; i++) {
const d = -TRACK.trackWidth * 0.5 + tileW * (i + 0.5);
const placement = {
x: finishP.x + finishN.x * d,
y: 0.035,
z: finishP.z + finishN.z * d,
rotationY,
};
(i % 2 === 0 ? tilesA : tilesB).push(placement);
}
const tileGeom = new THREE.BoxGeometry(tileW, 0.035, 0.6);
group.add(buildInstances(tileGeom, materials.finishLight, tilesA, { name: 'finish-light' }));
group.add(buildInstances(tileGeom, materials.finishDark, tilesB, { name: 'finish-dark' }));
// ── Stadyum Tribünlerini Sahneye Ekle
addNascarGrandstands(group);
scene.add(group);
return {
roadWidth: TRACK.trackWidth,
finishLine: {
center: finishP.clone().setY(0),
tangent: finishT.clone(),
normal: finishN.clone(),
halfWidth: TRACK.trackWidth * 0.5,
},
};
}
// --- NASCAR SAFER BETON GÜVENLİK DUVARLARI ---
export function addGuardrails(scene, curve, roadWidth, materials) {
const wallPlacements = [];
const topStripePlacements = [];
const offset = roadWidth * 0.5 + 1.1;
const segmentCount = 160;
const tangent = new THREE.Vector3();
for (let i = 0; i < segmentCount; i++) {
const u = i / segmentCount;
const p = curve.getPointAt(u);
curve.getTangentAt(u, tangent);
const nx = -tangent.z;
const nz = tangent.x;
const rotationY = Math.atan2(tangent.x, tangent.z);
// Dış duvar yüksek beton bariyer, iç duvar alçak pit duvarı
for (const side of [-1, 1]) {
const bx = p.x + nx * side * offset;
const bz = p.z + nz * side * offset;
wallPlacements.push({
x: bx,
y: side > 0 ? 0.65 : 0.45,
z: bz,
rotationY,
scale: { x: 1, y: side > 0 ? 1.3 : 0.9, z: 1 },
});
if (side > 0) {
topStripePlacements.push({ x: bx, y: 1.32, z: bz, rotationY });
}
}
}
const group = new THREE.Group();
group.name = 'guardrails';
// Beyaz NASCAR Beton Duvarları
const concreteMat = new THREE.MeshStandardMaterial({ color: 0xe6e8eb, roughness: 0.7 });
const redStripeMat = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.5 });
group.add(buildInstances(
new THREE.BoxGeometry(0.35, 1.0, 2.2),
concreteMat,
wallPlacements,
{ name: 'nascar-walls', castShadow: true }
));
// Dış duvar üstündeki kırmızı güvenlik şeridi
group.add(buildInstances(
new THREE.BoxGeometry(0.38, 0.12, 2.2),
redStripeMat,
topStripePlacements,
{ name: 'nascar-wall-stripe' }
));
return group;
}

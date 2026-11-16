import * as THREE from 'three';
import { buildInstances } from '../core/instancing.js';

export const TRACK = {
  centerZ: 10,
  outerW: 120,
  outerH: 58,
  trackWidth: 11.4,
  cornerRadius: 29,
  maxBankAngle: 0.38,
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
  const straightSamples = 24;
  const arcSamples = 28;

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

  pushStraight(-hW + r, -hH, hW - r, -hH);
  pushArc(hW - r, 0, -Math.PI * 0.5, Math.PI * 0.5);
  pushStraight(hW - r, hH, -hW + r, hH);
  pushArc(-hW + r, 0, Math.PI * 0.5, Math.PI * 1.5);

  return points;
}

export function createTrackCurve() {
  return new THREE.CatmullRomCurve3(buildCenterlinePoints(), true, 'centripetal', 0.2);
}

function getBankAngleAt(curve, u) {
  const step = 0.005;
  const t1 = curve.getTangentAt((u - step + 1) % 1);
  const t2 = curve.getTangentAt((u + step) % 1);
  const a1 = Math.atan2(t1.x, t1.z);
  const a2 = Math.atan2(t2.x, t2.z);
  let delta = a2 - a1;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  const turnFactor = Math.min(1, Math.abs(delta) / 0.045);
  return 0.08 + turnFactor * (TRACK.maxBankAngle - 0.08);
}

function getBankedSurfacePoint(curve, u, lateralOffset, extraY = 0) {
  const p = curve.getPointAt(u);
  const t = curve.getTangentAt(u);
  const nx = -t.z;
  const nz = t.x;
  const bank = getBankAngleAt(curve, u);
  const halfW = TRACK.trackWidth * 0.5;
  const normalizedLat = lateralOffset + halfW;
  const horizDist = Math.cos(bank) * normalizedLat - halfW;
  const y = Math.sin(bank) * normalizedLat + 0.02 + extraY;

  return {
    x: p.x + nx * horizDist,
    y,
    z: p.z + nz * horizDist,
    bank,
    rotationY: Math.atan2(t.x, t.z),
  };
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
    const offset = Math.sin(u * Math.PI * 2) * roadWidth * 0.14;
    out.push(new THREE.Vector3(p.x + nx * offset, 0, p.z + nz * offset));
  }
  return out;
}

function buildBankedRoadGeometry(curve) {
  const lengthSegments = 240;
  const widthSegments = 12;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= lengthSegments; i++) {
    const u = (i % lengthSegments) / lengthSegments;
    for (let j = 0; j <= widthSegments; j++) {
      const v = j / widthSegments;
      const lat = (v - 0.5) * TRACK.trackWidth;
      const pt = getBankedSurfacePoint(curve, u, lat, 0);
      positions.push(pt.x, pt.y, pt.z);
      uvs.push(v * 3, (i / lengthSegments) * 40);
    }
  }

  const rowStride = widthSegments + 1;
  for (let i = 0; i < lengthSegments; i++) {
    for (let j = 0; j < widthSegments; j++) {
      const a = i * rowStride + j;
      const b = (i + 1) * rowStride + j;
      const c = (i + 1) * rowStride + (j + 1);
      const d = i * rowStride + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function addNascarGrandstands(scene) {
  const tribuneGroup = new THREE.Group();
  tribuneGroup.name = 'nascar-grandstands';

  const seatColors = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xffffff];
  const rowCount = 16;
  const standLength = 78;
  const baseDistance = TRACK.outerH * 0.5 + 1.6;

  for (const side of [-1, 1]) {
    const baseMat = new THREE.MeshBasicMaterial({ color: 0x37474f });
    const baseGeo = new THREE.BoxGeometry(standLength, rowCount * 0.7, rowCount * 0.9);
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.set(0, (rowCount * 0.7) * 0.45, TRACK.centerZ + side * (baseDistance + (rowCount * 0.45)));
    tribuneGroup.add(baseMesh);

    for (let r = 0; r < rowCount; r++) {
      const seatRowGeo = new THREE.BoxGeometry(standLength - 0.5, 0.45, 0.65);
      const seatRowMat = new THREE.MeshBasicMaterial({
        color: seatColors[r % seatColors.length],
      });
      const seatMesh = new THREE.Mesh(seatRowGeo, seatRowMat);
      const yPos = 1.2 + r * 0.7;
      const zOffset = baseDistance + r * 0.85;
      seatMesh.position.set(0, yPos, TRACK.centerZ + side * zOffset);
      tribuneGroup.add(seatMesh);
    }

    const roofGeo = new THREE.BoxGeometry(standLength + 3, 0.5, rowCount * 0.95);
    const roofMat = new THREE.MeshBasicMaterial({ color: 0x1c232b });
    const roofMesh = new THREE.Mesh(roofGeo, roofMat);
    roofMesh.position.set(
      0,
      rowCount * 0.7 + 3.4,
      TRACK.centerZ + side * (baseDistance + rowCount * 0.42)
    );
    tribuneGroup.add(roofMesh);

    for (let x = -standLength * 0.45; x <= standLength * 0.45; x += standLength * 0.3) {
      const pillarGeo = new THREE.CylinderGeometry(0.3, 0.3, rowCount * 0.7 + 3.6, 8);
      const pillarMesh = new THREE.Mesh(pillarGeo, roofMat);
      pillarMesh.position.set(
        x,
        (rowCount * 0.7 + 3.6) * 0.5,
        TRACK.centerZ + side * (baseDistance + rowCount * 0.82)
      );
      tribuneGroup.add(pillarMesh);
    }
  }

  scene.add(tribuneGroup);
}

export function addTrackMesh(scene, curve, materials) {
  const group = new THREE.Group();
  group.name = 'track';

  const roadGeom = buildBankedRoadGeometry(curve);
  const roadMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d34,
    roughness: 0.82,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const road = new THREE.Mesh(roadGeom, roadMat);
  road.receiveShadow = true;
  group.add(road);

  const innerR = Math.max(2, TRACK.cornerRadius - TRACK.trackWidth);
  const islandGeom = new THREE.ShapeGeometry(
    roundedRectShape(TRACK.innerW - 0.35, TRACK.innerH - 0.35, Math.max(1.5, innerR - 0.2)),
    32
  );
  islandGeom.rotateX(-Math.PI * 0.5);
  const island = new THREE.Mesh(islandGeom, materials.grassInfield);
  island.position.set(0, 0.014, TRACK.centerZ);
  island.receiveShadow = true;
  group.add(island);

  const dashPlacements = [];
  const yellowLinePlacements = [];
  const dashCount = 220;
  const laneStep = TRACK.trackWidth / 3;
  const lane1Divider = -TRACK.trackWidth * 0.5 + laneStep;
  const lane2Divider = -TRACK.trackWidth * 0.5 + laneStep * 2;
  const innerApronOffset = -TRACK.trackWidth * 0.5 + 0.25;

  for (let i = 0; i < dashCount; i++) {
    const u = i / dashCount;
    const apronPt = getBankedSurfacePoint(curve, u, innerApronOffset, 0.02);
    yellowLinePlacements.push({
      x: apronPt.x,
      y: apronPt.y,
      z: apronPt.z,
      rotationY: apronPt.rotationY,
    });

    if (i % 2 === 0) {
      for (const divOffset of [lane1Divider, lane2Divider]) {
        const pt = getBankedSurfacePoint(curve, u, divOffset, 0.02);
        dashPlacements.push({
          x: pt.x,
          y: pt.y,
          z: pt.z,
          rotationY: pt.rotationY,
        });
      }
    }
  }

  const whiteLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xffd600 });

  group.add(buildInstances(
    new THREE.BoxGeometry(0.18, 0.05, 1.35),
    whiteLineMat,
    dashPlacements,
    { name: 'three-lane-dashes' }
  ));

  group.add(buildInstances(
    new THREE.BoxGeometry(0.22, 0.05, 1.75),
    yellowLineMat,
    yellowLinePlacements,
    { name: 'nascar-yellow-apron-line' }
  ));

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
const pt = getBankedSurfacePoint(curve, finishU, d, 0.03);
const placement = {
x: pt.x,
y: pt.y,
z: pt.z,
rotationY,
};
(i % 2 === 0 ? tilesA : tilesB).push(placement);
}
const tileGeom = new THREE.BoxGeometry(tileW, 0.05, 0.65);
group.add(buildInstances(tileGeom, materials.finishLight, tilesA, { name: 'finish-light' }));
group.add(buildInstances(tileGeom, materials.finishDark, tilesB, { name: 'finish-dark' }));
scene.add(group);
addNascarGrandstands(scene);
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
export function addGuardrails(scene, curve, roadWidth, materials) {
const wallPlacements = [];
const topStripePlacements = [];
const innerOffset = -roadWidth * 0.5 - 0.5;
const outerOffset = roadWidth * 0.5 + 0.35;
const segmentCount = 180;
for (let i = 0; i < segmentCount; i++) {
const u = i / segmentCount;
const innerPt = getBankedSurfacePoint(curve, u, innerOffset, 0.45);
wallPlacements.push({
x: innerPt.x,
y: innerPt.y,
z: innerPt.z,
rotationY: innerPt.rotationY,
scale: { x: 1, y: 0.9, z: 1 },
});
const outerPt = getBankedSurfacePoint(curve, u, outerOffset, 0.7);
wallPlacements.push({
x: outerPt.x,
y: outerPt.y,
z: outerPt.z,
rotationY: outerPt.rotationY,
scale: { x: 1, y: 1.4, z: 1 },
});
topStripePlacements.push({
x: outerPt.x,
y: outerPt.y + 0.72,
z: outerPt.z,
rotationY: outerPt.rotationY,
});
}
const group = new THREE.Group();
group.name = 'guardrails';
const concreteMat = new THREE.MeshBasicMaterial({ color: 0xe6e8eb });
const redStripeMat = new THREE.MeshBasicMaterial({ color: 0xd32f2f });
group.add(buildInstances(
new THREE.BoxGeometry(0.4, 1.0, 2.2),
concreteMat,
wallPlacements,
{ name: 'nascar-walls' }
));
group.add(buildInstances(
new THREE.BoxGeometry(0.44, 0.14, 2.2),
redStripeMat,
topStripePlacements,
{ name: 'nascar-wall-stripe' }
));
scene.add(group);
return group;
}

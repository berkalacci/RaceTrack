import * as THREE from 'three';
import Vehicle from '../Vehicle.js';
import { createTrackPath } from '../core/trackPath.js';
import { buildInstances } from '../core/instancing.js';
import {
  carConfigOverride,
  findPlayableCar,
  RIVAL_CARS,
} from '../config/carCatalog.js';
import { addBackgroundTrees, addGroundAndTerrain } from './environment.js';
import { addCity } from './city.js';
import { FREEROAM_LAYOUT, TILE } from '../config/cityCatalog.js';
import { addStreetLights, createPointLightPool } from './lights.js';
import { addTrackObstacles } from './obstacles.js';
import { createSceneMaterials } from './materials.js';
import {
  addGuardrails,
  addTrackMesh,
  buildRacingLine,
  createTrackCurve,
  sampleCenterline,
} from './track.js';
import { addWeatherEffects } from './weather.js';

const DAY_PROFILE = {
  background: 0x87ceeb,
  fogColor: 0xb0d8f0,
  fogNear: 80,
  fogFar: 350,
  hemiSky: 0xdceeff,
  hemiGround: 0x7a9462,
  hemiIntensity: 1.1,
  sunColor: 0xfff5dc,
  sunIntensity: 1.8,
  ambientColor: 0xc8daf0,
  ambientIntensity: 0.85,
  exposure: 1.05,
};

const ATMOSPHERE_CITY = {
  dark: DAY_PROFILE,
  light: DAY_PROFILE,
};

const ATMOSPHERE = {
  dark: DAY_PROFILE,
  light: DAY_PROFILE,
};

function createBaseScene(profiles) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DAY_PROFILE.background);
  scene.fog = new THREE.Fog(DAY_PROFILE.fogColor, DAY_PROFILE.fogNear, DAY_PROFILE.fogFar);

  const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 450);
  camera.position.set(-18, 11, -26);

  const hemi = new THREE.HemisphereLight(DAY_PROFILE.hemiSky, DAY_PROFILE.hemiGround, DAY_PROFILE.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(DAY_PROFILE.sunColor, DAY_PROFILE.sunIntensity);
  sun.position.set(22, 35, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const ambient = new THREE.AmbientLight(DAY_PROFILE.ambientColor, DAY_PROFILE.ambientIntensity);
  scene.add(ambient);

  let dark = false;
  let exposure = DAY_PROFILE.exposure;

  function setDarkMode(next) {
    dark = false;
    scene.background.setHex(DAY_PROFILE.background);
    scene.fog.color.setHex(DAY_PROFILE.fogColor);
    scene.fog.near = DAY_PROFILE.fogNear;
    scene.fog.far = DAY_PROFILE.fogFar;
    hemi.color.setHex(DAY_PROFILE.hemiSky);
    hemi.groundColor.setHex(DAY_PROFILE.hemiGround);
    hemi.intensity = DAY_PROFILE.hemiIntensity;
    sun.color.setHex(DAY_PROFILE.sunColor);
    sun.intensity = DAY_PROFILE.sunIntensity;
    ambient.color.setHex(DAY_PROFILE.ambientColor);
    ambient.intensity = DAY_PROFILE.ambientIntensity;
    exposure = DAY_PROFILE.exposure;
  }

  return {
    scene,
    camera,
    sun,
    setDarkMode,
    isDarkMode: () => false,
    exposure: () => exposure,
  };
}

function spawnPose(curve, u, laneOffset = 0) {
  const point = curve.getPointAt(u);
  const tangent = curve.getTangentAt(u);
  const nx = -tangent.z;
  const nz = tangent.x;
  return {
    x: point.x + nx * laneOffset,
    z: point.z + nz * laneOffset,
    heading: Math.atan2(tangent.x, tangent.z),
  };
}

function addRacingLineDebug(scene, waypoints, materials) {
  const markers = waypoints
    .filter((_, i) => i % 2 === 0)
    .map((wp) => ({ x: wp.x, y: 0.12, z: wp.z }));

  const group = new THREE.Group();
  group.name = 'waypoint-debug';
  group.visible = false;

  group.add(buildInstances(
    new THREE.SphereGeometry(0.09, 6, 5),
    materials.marker,
    markers,
    { name: 'waypoint-markers' }
  ));

  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(waypoints.map((wp) => new THREE.Vector3(wp.x, 0.07, wp.z))),
    new THREE.LineBasicMaterial({ color: 0x6dd4ff, transparent: true, opacity: 0.8 })
  );
  group.add(line);
  scene.add(group);
  return group;
}

function buildTrafficLoop(streetEvery, ringCells) {
  const span = ringCells * streetEvery * TILE;
  const corners = [
    { x: -span, z: -span },
    { x: span, z: -span },
    { x: span, z: span },
    { x: -span, z: span },
  ];

  const waypoints = [];
  const perEdge = 14;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    for (let step = 0; step < perEdge; step++) {
      const t = step / perEdge;
      waypoints.push(new THREE.Vector3(
        a.x + (b.x - a.x) * t,
        0,
        a.z + (b.z - a.z) * t
      ));
    }
  }
  return waypoints;
}

async function createFreeRoamWorld(base, materials, { carId, rivalCount }) {
  const { scene, camera } = base;

  addGroundAndTerrain(scene, materials, { city: true });
  const city = await addCity(scene, null, FREEROAM_LAYOUT);

  const spawnCell = city.streetCells
    .filter((cell) => cell.gx % FREEROAM_LAYOUT.streetEvery === 0)
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]
    ?? { x: 0, z: 0 };

  const playerEntry = findPlayableCar(carId);
  const car = await Vehicle.create(
    new THREE.Vector3(spawnCell.x, 0, spawnCell.z),
    carConfigOverride(playerEntry)
  );
  car.resetTo(spawnCell.x, spawnCell.z, 0);
  scene.add(car.group);
  camera.position.set(spawnCell.x, 5, spawnCell.z - 10);

  const loopWaypoints = buildTrafficLoop(FREEROAM_LAYOUT.streetEvery, 2);
  const racingPath = createTrackPath(loopWaypoints);

  const rivals = await Promise.all(
    RIVAL_CARS.slice(0, rivalCount).map(async (entry, i) => {
      const u = (i + 0.5) / rivalCount;
      const sample = racingPath.sample(u * racingPath.totalLength);
      const rival = await Vehicle.create(
        new THREE.Vector3(sample.x, 0, sample.z),
        carConfigOverride(entry, {
          lights: { realtime: false },
          effects: { exhaustParticles: 24 },
          dynamics: { maxSpeed: 11 + i },
        })
      );
      rival.resetTo(sample.x, sample.z, 0);
      rival.pace = 0.55;
      rival.laneOffset = 0;
      rival.displayName = entry.name;
      scene.add(rival.group);
      return rival;
    })
  );

  const weather = addWeatherEffects(scene, { baseZ: 0, area: 140 });

  const streetLights = createPointLightPool(scene, city.lampPosts, {
    size: 6,
    intensity: 2.4,
    distance: 28,
    range: 60,
  });

  function updateShadowFocus(focus) {
    base.sun.position.set(focus.x + 26, 44, focus.z + 18);
    base.sun.target.position.set(focus.x, 0, focus.z);
    base.sun.target.updateMatrixWorld();
  }
  updateShadowFocus(car.group.position);

  return { city, car, rivals, racingPath, loopWaypoints, weather, streetLights, updateShadowFocus };
}

export async function createScene({ carId = 'sedan', rivalCount = 3, scenario = 'city' } = {}) {
  const freeRoam = scenario === 'freeroam';
  const isCity = scenario === 'city' || freeRoam;
  const base = createBaseScene(isCity ? ATMOSPHERE_CITY : ATMOSPHERE);
  const { scene, camera } = base;
  const { materials, setDarkMode: setMaterialMode, dispose: disposeMaterials } = createSceneMaterials();

  if (freeRoam) {
    const world = await createFreeRoamWorld(base, materials, { carId, rivalCount });
    const setDarkEnvironment = () => {
      base.setDarkMode(false);
      setMaterialMode(false);
      world.weather.setDarkMode(false);
    };
    setDarkEnvironment();

    const freeRoamLights = {
      setEnabled: () => {},
      isEnabled: () => false,
      update(frameDt, focus) {
        world.updateShadowFocus(focus);
      },
    };

    return {
      scene,
      camera,
      scenario,
      freeRoam: true,
      car: world.car,
      rivals: world.rivals,
      cityStats: world.city.stats,
      cityCollider: world.city.collider,
      cityCells: world.city.cells,
      racingPath: world.racingPath,
      racingWaypoints: world.loopWaypoints,
      centerPath: null,
      finishLine: null,
      roadWidth: 7,
      obstacles: { propGroups: [] },
      waypointDebugGroup: null,
      streetLightsController: freeRoamLights,
      setDarkEnvironment,
      isDarkEnvironment: () => false,
      exposure: base.exposure,
      updateWeather: world.weather.update,
      dispose() {
        world.weather.dispose();
        disposeMaterials();
      },
    };
  }

  addGroundAndTerrain(scene, materials, { city: false });
  const curve = createTrackCurve();
  const { roadWidth, finishLine } = addTrackMesh(scene, curve, materials);
  addGuardrails(scene, curve, roadWidth, materials);
  const streetLights = addStreetLights(scene, curve, roadWidth, materials);

  const centerPath = createTrackPath(sampleCenterline(curve, 128));
  addBackgroundTrees(scene, materials);

  const racingWaypoints = buildRacingLine(curve, 96, roadWidth);
  const racingPath = createTrackPath(racingWaypoints);
  const waypointDebugGroup = addRacingLineDebug(scene, racingWaypoints, materials);

  const playerEntry = findPlayableCar(carId);
  const start = spawnPose(curve, 0.04);
  const car = await Vehicle.create(
    new THREE.Vector3(start.x, 0, start.z),
    carConfigOverride(playerEntry)
  );
  car.resetTo(start.x, start.z, start.heading);
  scene.add(car.group);
  camera.position.set(start.x - Math.sin(start.heading) * 9, 4, start.z - Math.cos(start.heading) * 9);

  const laneOffsets = [1.5, -1.5, 0.6, -0.6];
  const rivals = await Promise.all(
    RIVAL_CARS.slice(0, rivalCount).map(async (entry, i) => {
      const pose = spawnPose(curve, (0.04 - 0.058 * (i + 1) + 1) % 1, laneOffsets[i % laneOffsets.length]);
      const rival = await Vehicle.create(
        new THREE.Vector3(pose.x, 0, pose.z),
        carConfigOverride(entry, {
          lights: { realtime: false },
          effects: { exhaustParticles: 24 },
        })
      );
      rival.resetTo(pose.x, pose.z, pose.heading);
rival.pace = entry.pace;
rival.laneOffset = laneOffsets[i % laneOffsets.length];
rival.displayName = entry.name;
scene.add(rival.group);
return rival;
})
);
const obstacles = await addTrackObstacles(scene, curve, roadWidth);
const weather = addWeatherEffects(scene, { baseZ: 10 });
function setDarkEnvironment() {
base.setDarkMode(false);
setMaterialMode(false);
weather.setDarkMode(false);
streetLights.setEnabled(false);
}
setDarkEnvironment();
return {
scene,
camera,
car,
rivals,
scenario,
freeRoam: false,
cityStats: null,
cityCollider: null,
curve,
centerPath,
racingPath,
racingWaypoints,
roadWidth,
finishLine,
startPose: start,
obstacles,
waypointDebugGroup,
streetLightsController: streetLights,
setDarkEnvironment,
isDarkEnvironment: () => false,
exposure: base.exposure,
updateWeather: weather.update,
dispose() {
weather.dispose();
disposeMaterials();
},
};
}

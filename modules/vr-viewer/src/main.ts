import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#c') as HTMLCanvasElement,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(VRButton.createButton(renderer));

const nodes: { [id: string]: THREE.Mesh } = {};
const edges: THREE.Line[] = [];
const history: any[] = [];

const ws = new WebSocket('ws://localhost:8080');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  data.time = Date.now();
  history.push(data);
  updateGraph();
};

const timeline = document.getElementById('timeline') as HTMLInputElement;
timeline.addEventListener('input', () => {
  updateGraph();
});

const filters = document.getElementById('filters') as HTMLDivElement;
filters.addEventListener('change', () => {
    updateGraph();
});

function getFilters() {
    const filters = document.getElementById('filters') as HTMLDivElement;
    const checkboxes = filters.querySelectorAll('input[type="checkbox"]');
    const enabled: { [type: string]: boolean } = {};
    checkboxes.forEach((checkbox: HTMLInputElement) => {
        enabled[checkbox.value] = checkbox.checked;
    });
    return enabled;
}

function updateGraph() {
  const time = (parseInt(timeline.value) / 100) * Date.now();
  const filters = getFilters();
  const visibleHistory = history.filter((data) => data.time <= time && (data.type === 'addEdge' || filters[data.node.type]));

  Object.values(nodes).forEach((node) => scene.remove(node));
  edges.forEach((edge) => scene.remove(edge));

  visibleHistory.forEach((data) => {
    if (data.type === 'addNode') {
      const geometry = new THREE.SphereGeometry(0.1, 32, 32);
      const color = {
        feature: 0xff0000,
        scenario: 0x00ff00,
        step: 0x0000ff,
        waypoint: 0xffff00,
        site: 0xff00ff,
        page: 0x00ffff,
        access: 0xffffff,
      }[data.node.type] || 0xaaaaaa;
      const material = new THREE.MeshBasicMaterial({ color });
      const node = new THREE.Mesh(geometry, material);
      node.position.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      scene.add(node);
      nodes[data.node.id] = node;
    } else if (data.type === 'addEdge') {
      const source = nodes[data.edge.source];
      const target = nodes[data.edge.target];
      if (source && target) {
        const material = new THREE.LineBasicMaterial({ color: 0xffffff });
        const points = [source.position, target.position];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, material);
        scene.add(line);
        edges.push(line);
      }
    }
  });
}

camera.position.z = 5;

renderer.setAnimationLoop(function () {
  renderer.render(scene, camera);
});

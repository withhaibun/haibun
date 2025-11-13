import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

let camera: THREE.PerspectiveCamera, scene: THREE.Scene, renderer: THREE.WebGLRenderer;
let nodes: THREE.Mesh[] = [];
let edges: THREE.Line[] = [];
const nodePositions: THREE.Vector3[] = [];

init();
animate();

async function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));
    renderer.xr.enabled = true;

    const light = new THREE.PointLight(0xffffff, 1);
    light.position.set(5, 5, 5);
    scene.add(light);

    const ambientLight = new THREE.AmbientLight(0x404040);
    scene.add(ambientLight);

    const response = await fetch('/runGraph.json');
    const graphData = await response.json();

    const colorMap = {
        feature: 0xff0000,
        scenario: 0x00ff00,
        step: 0x0000ff,
        site: 0xffff00,
        page: 0xff00ff,
        access: 0x00ffff,
    };

    graphData.nodes.forEach(node => {
        const nodeMaterial = new THREE.MeshBasicMaterial({ color: colorMap[node.type] || 0xffffff });
        const nodeGeometry = new THREE.SphereGeometry(0.1, 32, 32);
        const mesh = new THREE.Mesh(nodeGeometry, nodeMaterial);
        mesh.userData.type = node.type;
        mesh.userData.id = node.id;
        mesh.position.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
        scene.add(mesh);
        nodes.push(mesh);
        nodePositions.push(mesh.position);
    });

    graphData.edges.forEach(edge => {
        const sourceNode = nodes.find(n => n.userData.id === edge.source);
        const targetNode = nodes.find(n => n.userData.id === edge.target);

        if (sourceNode && targetNode) {
            const edgeGeometry = new THREE.BufferGeometry().setFromPoints([sourceNode.position, targetNode.position]);
            const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
            const line = new THREE.Line(edgeGeometry, edgeMaterial);
            line.userData.time = edge.time;
            line.userData.sourceType = sourceNode.userData.type;
            line.userData.targetType = targetNode.userData.type;
            scene.add(line);
            edges.push(line);
        }
    });

    camera.position.z = 5;

    document.querySelectorAll('#filters input').forEach(input => {
        input.addEventListener('change', updateFilters);
    });

    document.getElementById('time-slider').addEventListener('input', updateTimeline);
}

function updateFilters() {
    const visibleTypes = Array.from(document.querySelectorAll('#filters input:checked')).map(input => (input as HTMLInputElement).value);
    nodes.forEach(node => {
        node.visible = visibleTypes.includes(node.userData.type);
    });
    edges.forEach(edge => {
        const sourceVisible = visibleTypes.includes(edge.userData.sourceType);
        const targetVisible = visibleTypes.includes(edge.userData.targetType);
        edge.visible = sourceVisible && targetVisible;
    });
}

function updateTimeline() {
    const slider = document.getElementById('time-slider') as HTMLInputElement;
    const maxTime = Math.max(...edges.map(edge => edge.userData.time));
    const currentTime = maxTime * (parseInt(slider.value) / 100);

    edges.forEach(edge => {
        edge.visible = edge.userData.time <= currentTime;
    });
    nodes.forEach(node => {
        const connectedEdges = edges.filter(edge => edge.userData.source === node.id || edge.userData.target === node.id);
        node.visible = connectedEdges.some(edge => edge.visible);
    });
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render() {
    renderer.render(scene, camera);
}

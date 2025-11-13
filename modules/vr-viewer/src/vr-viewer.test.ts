/**
 * @vitest-environment jsdom
 */
/**
 * @vitest-environment jsdom
 */
import { JSDOM } from 'jsdom';
import { beforeAll, describe, it, expect } from 'vitest';
import * as THREE from 'three';
import * as VRViewer from './vr-viewer';
import 'canvas';

describe('VR Viewer', () => {
    beforeAll(() => {
        const dom = new JSDOM('<!DOCTYPE html><html><body><div id="ui"></div></body></html>', {
            url: 'http://localhost',
        });
        global.window = dom.window;
        global.document = dom.window.document;
        global.navigator = dom.window.navigator;
        global.requestAnimationFrame = dom.window.requestAnimationFrame;
        global.cancelAnimationFrame = dom.window.cancelAnimationFrame;
    });

    it('should initialize the scene', async () => {
        await VRViewer.init();
        expect(VRViewer.scene).toBeInstanceOf(THREE.Scene);
        expect(VRViewer.camera).toBeInstanceOf(THREE.PerspectiveCamera);
        expect(VRViewer.renderer).toBeInstanceOf(THREE.WebGLRenderer);
        VRViewer.animate();
    });
});

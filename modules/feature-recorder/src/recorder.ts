#!/usr/bin/env node

import { run } from '@haibun/core/build/lib/run.js';
import { getDefaultWorld } from '@haibun/core/build/lib/test/lib.js';
import { getDefaultOptions, getStepperOptionName, trying } from '@haibun/core/build/lib/util/index.js';
import WebSocketServer from '@haibun/context/build/websocket-server/websockets-server.js';
import WebPlaywright from '@haibun/web-playwright/build/web-playwright.js';
import StorageFS from '@haibun/storage-fs/build/storage-fs.js';
import DomainStorage from '@haibun/domain-storage/build/domain-storage.js';
import DomainWebPage from '@haibun/domain-webpage/build/domain-webpage.js';
import FeatureImporter from '@haibun/feature-importer/build/feature-importer-stepper.js';
import Haibun from '@haibun/core/build/steps/haibun.js';
import { TWorld } from '@haibun/core/build/lib/defs.js';
import WebServerStepper from '@haibun/web-server-express/build/web-server-stepper.js';

export async function record(url: string, featureFilter: string[], options?: { world?: TWorld }) {
    const specl = getDefaultOptions();
    const world = options?.world || getDefaultWorld(0).world;
    const loc = `node_modules/@haibun/browser-extension/`

    const defaultExtraOptions = {
        [getStepperOptionName(WebPlaywright, 'STORAGE')]: 'StorageFS',
        [getStepperOptionName(WebPlaywright, 'PERSISTENT_DIRECTORY')]: 'true',
        [getStepperOptionName(WebPlaywright, 'HEADLESS')]: 'false',
        [getStepperOptionName(WebPlaywright, 'ARGS')]: `--disable-extensions-except=${loc}public/`,
        [getStepperOptionName(WebServerStepper, 'PORT')]: '8126',
    };
    for (const [name, value] of Object.entries(defaultExtraOptions)) {
        world.extraOptions = {
            ...world.extraOptions,
            [name]: world.extraOptions[name] || value
        }
    }
    world.options = { ...world.options, env: { SITE: url } };


    const addSteppers = [Haibun, FeatureImporter, WebPlaywright, WebSocketServer, StorageFS, DomainStorage
        , DomainWebPage, WebServerStepper];

    const result = await run({ specl, bases: ['./recorder'], featureFilter, addSteppers, world });

    return result;
}

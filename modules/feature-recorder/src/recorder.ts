import { run } from '@haibun/core/build/lib/run';
import { getDefaultWorld } from '@haibun/core/build/lib/test/lib';
import { getDefaultOptions, getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import WebSocketServer from '@haibun/context/build/websocket-server/websockets-server';
import ServerExpress from '@haibun/web-server-express/build/web-server-stepper';
import WebPlaywright from '@haibun/web-playwright';
import StorageFS from '@haibun/storage-fs';
import DomainStorage from '@haibun/domain-storage';
import DomainWebPage from '@haibun/domain-webpage';
import FeatureImporter from '@haibun/feature-importer/build/feature-importer-stepper';
import Vars from '@haibun/core/build/steps/vars';
import Haibun from '@haibun/core/build/steps/haibun';
import { TWorld } from '@haibun/core/build/lib/defs';
import WebServerStepper from '@haibun/web-server-express/build/web-server-stepper';

export async function record(url: string, featureFilter: string[], options?: { world?: TWorld }) {
    const specl = getDefaultOptions();
    const world = options?.world || getDefaultWorld(0).world;
    const defaultExtraOptions = {
        [getStepperOptionName(WebPlaywright, 'STORAGE')]: 'StorageFS',
        [getStepperOptionName(WebPlaywright, 'PERSISTENT_DIRECTORY')]: 'true',
        [getStepperOptionName(WebPlaywright, 'HEADLESS')]: 'false',
        [getStepperOptionName(WebPlaywright, 'ARGS')]: '--disable-extensions-except=./node_modules/@haibun/browser-extension/public/',
        [getStepperOptionName(WebServerStepper, 'PORT')]: '8126',
    };
    for (const [name, value] of Object.entries(defaultExtraOptions)) {
        world.extraOptions = {
            ...world.extraOptions,
            [name]: world.extraOptions[name] || value
        }
    }

    world.options = { ...world.options, env: { SITE: url } };

    const result = await run({ specl, base: './recorder', featureFilter, addSteppers: [Haibun, FeatureImporter, WebPlaywright, WebSocketServer, StorageFS, DomainStorage, DomainWebPage, ServerExpress], world });
    console.log('🤑', JSON.stringify({ ok: result.ok, failure: result.failure }, null, 2));

    return result;
}

import { PortOnMessage } from "./PortOnMessage";
import { PortRuntimeOnMessage } from "./PortRuntimeOnMessage";
import { PortRuntimeOnConnect } from "./PortRuntimeOnConnect";
import { PortDisconnect } from "./PortDisconnect";

const connected: any = {};
let defaultConnector: MockPort;

export class MockPort implements chrome.runtime.Port {
    constructor(name: string, sender?: chrome.runtime.MessageSender) {
        this.name = name;
        this.sender = sender;
        this.onDisconnect = new PortDisconnect();
        this.onMessage = new PortOnMessage();
        this.listeners = [];
    }

    listeners: any[];
    name: string;
    postMessage: chrome.runtime.Port['postMessage'] = (message: any) => {
        console.log('postMessage', message);
    };
    disconnect = () => console.log('disconnect');
    /**
     * Optional.
     * This property will only be present on ports passed to onConnect/onConnectExternal listeners.
     */
    sender?: chrome.runtime.MessageSender | undefined;
    /** An object which allows the addition and removal of listeners for a Chrome event. */
    onDisconnect = new PortDisconnect();
    /** An object which allows the addition and removal of listeners for a Chrome event. */
    onMessage = new PortOnMessage();
}

const connect: typeof chrome.runtime.connect = (extensionId: any, ci?: chrome.runtime.ConnectInfo) => {
    const name = ci?.name;
    const connector = new MockPort(name || 'foo');
    if (name) {
        connected[name] = connector;
    } else {
        defaultConnector = connector;
    }
    return connector;
}

export type TPortContext= {
    listeners: TListener[];
}

export type TListener = any;

const ctx = { listeners: <TListener>[]};
const onMessage: chrome.runtime.ExtensionMessageEvent = new PortRuntimeOnMessage(ctx);
const onConnect: chrome.runtime.ExtensionConnectEvent = new PortRuntimeOnConnect(ctx);

const sendMessage = async (message: any) => {
   for (const listener of ctx.listeners) {
       listener(message);
   }
};

class MockChrome {
    runtime = {
        connect,
        onMessage,
        sendMessage,
        onConnect,

        connectNative: undefined,
        getBackgroundPage: undefined,
        getManifest: undefined,
        getPackageDirectoryEntry: undefined,
        getPlatformInfo: undefined,
        getURL: undefined,
        reload: undefined,
        requestUpdateCheck: undefined,
        restart: undefined,
        restartAfterDelay: undefined,
        sendNativeMessage: undefined,
        setUninstallURL: undefined,
        openOptionsPage: undefined,
        lastError: undefined,
        id: '',
        OnInstalledReason: undefined,
        onConnectExternal: undefined,
        onSuspend: undefined,
        onStartup: undefined,
        onInstalled: undefined,
        onSuspendCanceled: undefined,
        onMessageExternal: undefined,
        onRestartRequired: undefined,
        onUpdateAvailable: undefined,
        onBrowserUpdateAvailable: undefined
    }

    extension: Partial<typeof chrome.extension> = {
        getBackgroundPage: undefined,
        getURL: undefined,
        setUpdateUrlData: undefined,
        getViews: undefined,
        isAllowedFileSchemeAccess: undefined,
        isAllowedIncognitoAccess: undefined,
        sendRequest: undefined,
        getExtensionTabs: undefined,
        inIncognitoContext: false,
        lastError: undefined,
        onRequest: undefined,
        onRequestExternal: undefined
    }
}

export default MockChrome;

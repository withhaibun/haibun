import { DEFAULT_PORT } from "../index.js";
import Background from "./Background.js";
import LoggerWebSocketsClient from "@haibun/context/build/websocket-client/LoggerWebSocketsClient.js";
import { popupActions } from "../services/constants.js";
import { ChromeExtensionKeepAlive } from "../ChromeExtensionKeepAlive.js";

declare global {
  interface Window { background: Background; }
}

const port = DEFAULT_PORT;
const keepAlive = new ChromeExtensionKeepAlive();

const webSocketLogger = new LoggerWebSocketsClient(port, { keepAlive });
const background = new Background(webSocketLogger);
background.init();

await loggerConnect(webSocketLogger);

async function loggerConnect(logger: LoggerWebSocketsClient) {
  const errorHandler = {
    onError: (error: any) => {
      background.onMessage({ action: 'ERROR', value: `Could not connect to websocket on port ${port} ${JSON.stringify(error)}.` });
    }
  };
  await logger.connect(errorHandler);
}

background.onMessage({ action: popupActions.READY });
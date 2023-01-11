import { DEFAULT_PORT } from "..";
import Background from "./Background";
import LoggerWebSocketsClient from "@haibun/context/build/websocket-client/LoggerWebSocketsClient";
import { popupActions } from "../services/constants";
import { ChromeExtensionKeepAlive } from "../ChromeExtensionKeepAlive";

declare global {
  interface Window { background: Background; }
}

const port = DEFAULT_PORT;
const keepAlive = new ChromeExtensionKeepAlive();

const webSocketLogger = new LoggerWebSocketsClient(port, { keepAlive });
const background = new Background(webSocketLogger);
background.init();

loggerConnect(webSocketLogger);

async function loggerConnect(logger: LoggerWebSocketsClient) {
  const errorHandler = (error: any) => {
    background.onMessage({ action: 'ERROR', value: `Could not connect to websocket on port ${port} ${JSON.stringify(error)}.` });
  }
  await logger.connect(errorHandler);
}

background.onMessage({ action: popupActions.READY });
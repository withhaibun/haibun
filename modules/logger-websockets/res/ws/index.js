(async function () {
  const ws = await connectToServer();
  ws.send('catchup')

  ws.onmessage = (webSocketMessage) => {
    const messageBody = JSON.parse(webSocketMessage.data);
    console.log(messageBody);
  };

  async function connectToServer() {
    const ws = new WebSocket('ws://localhost:7071/ws');
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (ws.readyState === 1) {
          clearInterval(timer);
          resolve(ws);
        }
      }, 10);
    });
  }
})();

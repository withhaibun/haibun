"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HaibunServer = void 0;
const express = require('express');
const app = express();
class HaibunServer {
    constructor(logger, port) {
        this.logger = logger;
        this.port = port;
    }
    start() {
        app.listen(this.port, () => this.logger.log(`Server listening on port: ${this.port}`));
        app.use(express.static('public'));
    }
    addRoute() {
        app.get('/', (req, res) => {
            res.send('Hello World!');
        });
    }
    addFiles(loc) {
        app.use(express.static('public'));
    }
}
exports.HaibunServer = HaibunServer;
//# sourceMappingURL=server.js.map
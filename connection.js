const Web3 = require('web3');

class Web3Connection {
  constructor(rpc) {
    this.wsOption = {
      timeout: 10000,
      clientConfig: {
        keepalive: true,
        keepaliveInterval: 3000,
      },
      reconnect: {
        auto: true,
        delay: 2000,
        maxAttempts: 5,
        onTimeout: true,
      },
      reconnectDelay: 1,
    };
    this.rpc = rpc;
  }
  getProvider() {
    let prov = this.rpc;
    if (this.rpc.startsWith('http')) {
      prov = new Web3.providers.HttpProvider(this.rpc);
    }
    if (this.rpc.startsWith('ws')) {
      prov = new Web3.providers.WebsocketProvider(this.rpc, this.wsOption);
    }
    return prov;
  }
  createConnection() {
    return new Web3(this.getProvider());
  }
}

module.exports = Web3Connection;

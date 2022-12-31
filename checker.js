const abiDecoder = require('abi-decoder');
const { formatUnits } = require('@ethersproject/units');
const { BigNumber } = require('@ethersproject/bignumber');
const Web3Connection = require( './connection');
const nodes = require('./config/node.json');
const routers = require('./config/router.json');
const router_abi = require('./config/router-abi.json');
const pair_abi = require('./config/pair-abi.json');
const erc20_abi = require('./config/erc20-abi.json');

class Checker {
  constructor(rpc) {
    this.abiDecoder = abiDecoder;
    this.abiDecoder.addABI(router_abi);
    this.abiDecoder.addABI(pair_abi);

    if (rpc && rpc !== '') {
      this.web3 = new Web3Connection(rpc).createConnection();
    }
  }

  setRouterContract(address) {
    this.router_contract = new this.web3.eth.Contract(router_abi, address);
  }

  setTokenContract() {
    this.token_contract = new this.web3.eth.Contract(erc20_abi);
  }

  async getDecimal(token_address) {
    try {
      const data = this.token_contract.methods.decimals().encodeABI();
      const decimal = await this.web3.eth.call({ to: token_address, data });
      return Promise.resolve(this.web3.eth.abi.decodeParameter('uint', decimal));
    } catch (error) {
      return Promise.resolve(18);
    }
  }

  async getTokenName(token_address) {
    try {
      const data = this.token_contract.methods.name().encodeABI();
      const name = await this.web3.eth.call({ to: token_address, data });
      return Promise.resolve(this.web3.eth.abi.decodeParameter('string', name));
    } catch (error) {
      return Promise.resolve('unknown');
    }
  }

  async getTokenDetail(token_address) {
    try {
      const name = await this.getTokenName(token_address);
      const decimal = await this.getDecimal(token_address);

      return Promise.resolve({
        name,
        decimal: Number(decimal)
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async convertTokenToWeth(token_address, weth_address, balance, block) {
    let result;
    let try_count = 0;
    while(!result && try_count < 5) {
      try {
        const rate = await this.router_contract.methods.getAmountsOut(
          this.web3.utils.toHex(balance),
          [token_address.trim(), weth_address.trim()]
        ).call({}, block || 'latest');

        // const weth = await this.formatUnit(rate[rate.length - 1], 18);
        result = BigNumber.from(rate[rate.length - 1]);
      } catch (err) {
        // https://github.com/ethereum/go-ethereum/issues/16123
        console.log('error convertTokenToWeth: ', err);
        try_count++;
      }
    }

    if (!result) {
      try {
        const rate = await this.router_contract.methods.getAmountsOut(
          this.web3.utils.toHex(balance),
          [token_address.trim(), weth_address.trim()]
        ).call();

        result = BigNumber.from(rate[rate.length - 1]);
      } catch (err) {
        // https://github.com/ethereum/go-ethereum/issues/16123
        console.log('error convertTokenToWeth: ', err);
        result = BigNumber.from(0);
      }
    }

    return Promise.resolve(result);
  }

  async convertTokenToUsdt(weth_address, usdt_address, balance, block) {
    let result;
    let try_count = 0;
    while(!result && try_count < 5) {
      try {
        const rate = await this.router_contract.methods.getAmountsOut(
          this.web3.utils.toHex(balance),
          [weth_address.trim(), usdt_address.trim()]
        ).call({}, block || 'latest');

        // const weth = await this.formatUnit(rate[rate.length - 1], 18);
        result = BigNumber.from(rate[rate.length - 1]);
      } catch (err) {
        // https://github.com/ethereum/go-ethereum/issues/16123
        console.log('error convertTokenToWeth: ', err);
        try_count++;
      }
    }

    if (!result) {
      try {
        const rate = await this.router_contract.methods.getAmountsOut(
          this.web3.utils.toHex(balance),
          [weth_address.trim(), usdt_address.trim()]
        ).call();

        result = BigNumber.from(rate[rate.length - 1]);
      } catch (err) {
        // https://github.com/ethereum/go-ethereum/issues/16123
        console.log('error convertTokenToUsdt: ', err);
        result = BigNumber.from(0);
      }
    }

    return Promise.resolve(result);
  }

  async formatUnit(balance, decimal) {
    try {
      if (!decimal) decimal = await this.getDecimal();
      decimal = BigNumber.from(decimal ? decimal : 18);

      return formatUnits(BigNumber.from(balance), decimal);
    } catch (err) {
      console.log('error formatUnit', err)
    }
  }

  async getTransaction(connection, txhash) {
    try {
      const tx = await connection.eth.getTransaction(txhash);
      const decodedInput = this.abiDecoder.decodeMethod(tx.input);
      if (!decodedInput) {
        throw new Error(`transaction ${txhash} not found`);
      }

      const chain_id = await connection.eth.getChainId();

      let chain = 'unknown';
      let router = 'unknown';
      try {
        chain = nodes[chain_id];
        chain = chain.name;
      } catch (error) {
        console.error(`chain not identified`)
      }

      try {
        router = routers[tx.to.toLowerCase()];
      } catch (error) {
        console.error(`router not identified`)
      }


      return Promise.resolve({
        ...tx,
        decoded_input: decodedInput,
        chain: chain,
        router,
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async getTransactionNetwork(txhash) {
    try {
      let transaction;
      if (this.web3) {
        try {
          transaction = await this.getTransaction(this.web3, txhash);
        } catch (error) {
          console.error(error);
        }
      } else {
        await Promise.all(Object.keys(nodes).map(async (node) => {
          try {
            if (!transaction) {
              const connection = new Web3Connection(nodes[node].rpc).createConnection();
              const tx = await this.getTransaction(connection, txhash);
              this.web3 = connection;
              transaction = tx;
            }
          } catch (error) {
            // console.error(error);
          }
        }));
      }

      if (!transaction) {
        throw new Error(`transaction is not detected in any registered network`);
      }

      this.setRouterContract(transaction.to);
      this.setTokenContract();
      return Promise.resolve(transaction);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  async getSwapAtFromTransaction(txhash) {
    try {
      let state = 'swap';
      let path = [];
      let address_to = '';
      let swap_buy = BigNumber.from(0);
      let swap_sell = BigNumber.from(0);
      let swap_sell_weth_rate = BigNumber.from(0);
      let swap_buy_weth_rate = BigNumber.from(0);
      let swap_sell_usdt_rate = BigNumber.from(0);
      let swap_buy_usdt_rate = BigNumber.from(0);
      let token_0 = {
        name: 'weth',
        decimal: 18
      };
      let token_1 = {
        name: 'weth',
        decimal: 18
      };

      const transaction = await this.getTransactionNetwork(txhash);
      transaction.decoded_input.params.forEach((param) => {
        if (param.name == 'path') path = param.value;
        if (param.name == 'to') address_to = param.value;
      });

      const receipt = await this.web3.eth.getTransactionReceipt(txhash);
      if (!receipt) {
        throw new Error(`transaction doesn't have a receipt yet or not finished`);
      }

      const filtered_logs = receipt.logs.filter((log) => log.topics.some((topic) => {
        return topic.toLowerCase() == '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'.toLowerCase()
      }));

      const decoded_logs = this.abiDecoder.decodeLogs(filtered_logs);
      if (decoded_logs.length > 0) {
        decoded_logs.forEach((decoded) => {
          if (decoded.events && decoded.events.length > 0) {
            decoded.events.forEach((data) => {
              if (data.name === 'amount0In') {
                swap_buy = swap_buy.add(BigNumber.from(data.value));
              }
              if (data.name === 'amount1Out') {
                swap_sell = swap_sell.add(BigNumber.from(data.value));
              }
            });
          }
        });
      }

      if (path[0].toLowerCase() == transaction.router.weth_address.toLowerCase()) {
        state = 'buy';
        swap_buy_weth_rate = swap_buy;
        swap_sell_weth_rate = await this.convertTokenToWeth(path[path.length - 1], transaction.router.weth_address, swap_sell, transaction.blockNumber);
        token_1 = await this.getTokenDetail(path[path.length - 1]);
      } else if (path[path.length - 1].toLowerCase() == transaction.router.weth_address.toLowerCase()) {
        state = 'sell';
        swap_sell_weth_rate = swap_sell;
        swap_buy_weth_rate = await this.convertTokenToWeth(path[0], transaction.router.weth_address, swap_buy, transaction.blockNumber);
        token_0 = await this.getTokenDetail(path[0]);
      } else {
        swap_sell_weth_rate = await this.convertTokenToWeth(path[path.length - 1], transaction.router.weth_address, swap_sell, transaction.blockNumber);
        swap_buy_weth_rate = await this.convertTokenToWeth(path[0], transaction.router.weth_address, swap_buy, transaction.blockNumber);
        token_0 = await this.getTokenDetail(path[0]);
        token_1 = await this.getTokenDetail(path[path.length - 1]);
      }

      swap_buy_usdt_rate = await this.convertTokenToUsdt(transaction.router.weth_address, transaction.router.usdt_address, swap_buy_weth_rate, transaction.blockNumber);
      swap_sell_usdt_rate = await this.convertTokenToUsdt(transaction.router.weth_address, transaction.router.usdt_address, swap_sell_weth_rate, transaction.blockNumber);

      const result = {
        ...transaction,
        swap: {
          swap_at_block: transaction.blockNumber,
          recipient: address_to,
          token_0,
          token_1,
          state,
          original_amount: {
            token_0: await this.formatUnit(swap_buy, token_0.decimal),
            token_1: await this.formatUnit(swap_sell, token_1.decimal),
          },
          weth_amount: {
            token_0: await this.formatUnit(swap_buy_weth_rate, 18),
            token_1: await this.formatUnit(swap_sell_weth_rate, 18),
          },
          usdt_amount: {
            token_0: await this.formatUnit(swap_buy_usdt_rate, transaction.router.usdt_decimal),
            token_1: await this.formatUnit(swap_sell_usdt_rate, transaction.router.usdt_decimal),
          }
        },
      };

      result.swap.original_amount.estimated_fee = (Number(result.swap.original_amount.token_0) * Number(transaction.router.swap_fee)).toString();
      result.swap.weth_amount.estimated_fee = (Number(result.swap.weth_amount.token_0) * Number(transaction.router.swap_fee)).toString();
      result.swap.usdt_amount.estimated_fee = (Number(result.swap.usdt_amount.token_0) * Number(transaction.router.swap_fee)).toString();

      return Promise.resolve(result);
    } catch (err) {
      return Promise.reject(err);
    }
  }
}

module.exports = Checker;

/* eslint-disable no-console */
const fs = require('fs');
const truffleConfig = require('../truffle.js');

const Bridge = artifacts.require('Bridge');
const Vault = artifacts.require('Vault');
const LeapToken = artifacts.require('LeapToken');
const POSoperator = artifacts.require('POSoperator');
const ExitHandler = artifacts.require('ExitHandler');
const PriorityQueue = artifacts.require('PriorityQueue');
const AdminableProxy = artifacts.require('AdminableProxy');

const logError = err => { if (err) { console.log(err); } }

function abiFileString(abi) {
  return `module.exports = ${JSON.stringify(abi)}`;
}

function writeAbi(name, abi) {
  fs.writeFile(`./build/nodeFiles/${name}.js`, abiFileString(abi), logError);
}

function writeConfig(bridgeAddr, operatorAddr, exitHandlerAddr, network) {
  const networkData = truffleConfig.networks[network];
  const rootNetwork = `http://${networkData.host}:${networkData.port}`;
  const networkId = Math.floor(Math.random() * Math.floor(1000000000));
  const config = {
    "bridgeAddr": bridgeAddr,
    "operatorAddr": operatorAddr,
    "exitHandlerAddr": exitHandlerAddr,
    "rootNetwork": rootNetwork,
    "network": network,
    "networkId": networkId,
    "peers": []
  }
  fs.writeFile("./build/nodeFiles/generatedConfig.json", JSON.stringify(config), logError);
}

module.exports = (deployer, network, accounts) => {
  const admin = accounts[1];

  const maxReward = 50;
  const parentBlockInterval = 0;
  const epochLength = 5;
  const exitDuration = 0;
  const exitStake = 0;

  let data;

  deployer.then(async () => {
    const leapToken = await LeapToken.deployed();
    console.log('  ♻️  Reusing existing Leap Token:', leapToken.address);

    const bridgeCont = await deployer.deploy(Bridge);
    data = await bridgeCont.contract.initialize.getData(parentBlockInterval, maxReward);
    const bridgeProxy = await deployer.deploy(AdminableProxy, bridgeCont.address, data, {from: admin});

    const pqLib = await deployer.deploy(PriorityQueue);
    ExitHandler.link('PriorityQueue', pqLib.address);

    const exitHandlerCont = await deployer.deploy(ExitHandler);
    data = await exitHandlerCont.contract.initializeWithExit.getData(bridgeProxy.address, exitDuration, exitStake);
    const exitHandlerProxy = await deployer.deploy(AdminableProxy, exitHandlerCont.address, data, {from: admin});

    const operatorCont = await deployer.deploy(POSoperator);
    data = await operatorCont.contract.initialize.getData(bridgeProxy.address, exitHandlerProxy.address, epochLength);
    const operatorProxy = await deployer.deploy(AdminableProxy, operatorCont.address, data, {from: admin});

    const bridge = Bridge.at(bridgeProxy.address);
    data = await bridge.contract.setOperator.getData(operatorProxy.address);
    await bridgeProxy.applyProposal(data, {from: admin});

    const vault = Vault.at(exitHandlerProxy.address);
    data = await vault.contract.registerToken.getData(leapToken.address, false);
    await exitHandlerProxy.applyProposal(data, {from: admin});

    try {
      fs.mkdirSync('./build/nodeFiles');
    } catch(error) {
      // we don;t care
    }

    writeAbi('bridgeAbi', Bridge.abi);
    writeAbi('exitHandler', ExitHandler.abi);
    writeAbi('operator', POSoperator.abi);

    writeConfig(bridgeProxy.address, operatorProxy.address, exitHandlerProxy.address, network);

    console.log("Generated node files in /build/nodeFiles");
  })
}
import chai from 'chai';

const time = require('./helpers/time');

const Bridge = artifacts.require('BridgeMock');
const Operator = artifacts.require('OperatorMock');
const Vault = artifacts.require('VaultMock');
const AdminableProxy = artifacts.require('AdminableProxy');
const MinGov = artifacts.require('MinGov');

chai.use(require('chai-as-promised')).should();

contract('MinGov', (accounts) => {

  let bridge;
  let bridgeProxy;
  let gov;

  beforeEach(async () => {
    gov = await MinGov.new(0);
    // bridge
    const bridgeLogic = await Bridge.new();
    bridgeProxy = await AdminableProxy.new(bridgeLogic.address, 0);
    bridge = Bridge.at(bridgeProxy.address);
    await bridgeProxy.changeAdmin(gov.address);
  });

  it('should allow to propose and finalize one operation', async () => {
    // check value before
    let operator = await bridge.operator();
    assert.equal(operator, '0x0000000000000000000000000000000000000000');
    // propose and finalize value change
    const data = await bridge.contract.setOperator.getData(accounts[1]);
    await gov.propose(bridge.address, data);
    await gov.finalize();

    // check value after
    operator = await bridge.operator();
    assert.equal(operator, accounts[1]);
  });

  it('should allow to propose and finalize multiple operations', async () => {
    // operator
    const operatorLogic = await Operator.new();
    const proxyOp = await AdminableProxy.new(operatorLogic.address, 0);
    // await proxyOp.initialize(operatorLogic.address);
    const operator = Operator.at(proxyOp.address);
    await proxyOp.changeAdmin(gov.address);

    // propose and finalize value changes
    const data1 = await operator.contract.setMinGasPrice.getData(200);
    await gov.propose(operator.address, data1);
    const data2 = await operator.contract.setEpochLength.getData(32);
    await gov.propose(operator.address, data2);
    let size = await gov.size();
    let first = await gov.first();
    assert.equal(size.toNumber(), 2);
    await gov.finalize();

    // check values after
    const minGasPrice = await operator.minGasPrice();
    assert.equal(minGasPrice.toNumber(), 200);
    const epochLength = await operator.epochLength();
    assert.equal(epochLength.toNumber(), 32);

    // propose and finalize value changes
    const data3 = await operator.contract.setParentBlockInterval.getData(300);
    await gov.propose(operator.address, data3);
    first = await gov.first();
    // position 1 and 2 have been used in first finalize
    assert.equal(first.toNumber(), 3);
    size = await gov.size();
    assert.equal(size.toNumber(), 1);
    await gov.finalize();

    // check values after
    const parentBlockInterval = await operator.parentBlockInterval();
    assert.equal(parentBlockInterval.toNumber(), 300);
    first = await gov.first();
    size = await gov.size();
    // position 3 in second finalize
    assert.equal(first.toNumber(), 4);
    // nothing in the pipe
    assert.equal(size.toNumber(), 0);
  });


  it('should allow to finalize same operation multiple times', async () => {
    // vault
    const vaultLogic = await Vault.new();
    const proxyVa = await AdminableProxy.new(vaultLogic.address, 0);
    // await proxyVa.initialize(vaultLogic.address);
    const vault = Vault.at(proxyVa.address);
    await proxyVa.changeAdmin(gov.address);

    // propose and finalize value change
    const data = await vault.contract.registerToken.getData(accounts[1]);
    await gov.propose(vault.address, data);
    await gov.finalize();

    // check value after
    let count = await vault.tokenCount();
    assert.equal(count, 1);

    // propose and finalize value change
    const data2 = await vault.contract.registerToken.getData(accounts[2]);
    await gov.propose(vault.address, data2);
    await gov.finalize();

    // check value after
    count = await vault.tokenCount();
    assert.equal(count, 2);

    const first = await gov.first();
    const size = await gov.size();
    // position 3 in second finalize
    assert.equal(first.toNumber(), 3);
    // nothing in the pipe
    assert.equal(size.toNumber(), 0);
  });

  it('should allow to upgrade bridge', async () => {
    // deploy new contract
    const proxy = AdminableProxy.at(bridge.address);
    const newBridgeLogic = await Bridge.new();

    // propose and finalize upgrade
    const data = await proxy.contract.upgradeTo.getData(newBridgeLogic.address);
    await gov.propose(bridge.address, data);
    await gov.finalize();

    // check value after
    const imp = '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';
    const logicAddr = await web3.eth.getStorageAt(proxy.address, imp);
    assert.equal(logicAddr, newBridgeLogic.address);
  });

  it('should allow to transfer into new governance', async () => {

    // propose and finalize upgrade
    const data = await bridgeProxy.contract.changeAdmin.getData(accounts[1]);
    await gov.propose(bridge.address, data);
    await gov.finalize();

    // check value after
    const ownerAddr = await bridge.admin();
    assert.equal(ownerAddr, accounts[1]);
  });

  it('should hold proposal for some time', async () => {
    await time.advanceBlock();

    const openingTime = await time.latest();
    const afterClosingTime = openingTime + time.duration.weeks(2) + time.duration.seconds(1);


    gov = await MinGov.new(time.duration.weeks(2));
    // bridge
    const bridgeLogic = await Bridge.new();
    const proxy = await AdminableProxy.new(bridgeLogic.address, 0);
    // await proxy.initialize(bridgeLogic.address);
    bridge = Bridge.at(proxy.address);
    await proxy.changeAdmin(gov.address);

    // check value before
    let operator = await bridge.operator();
    assert.equal(operator, '0x0000000000000000000000000000000000000000');
    // propose and finalize value change
    const data = await bridge.contract.setOperator.getData(accounts[1]);
    await gov.propose(bridge.address, data);

    // try before time passed
    await gov.finalize();
    operator = await bridge.operator();
    assert.equal(operator, '0x0000000000000000000000000000000000000000');

    // wait and try again
    await time.increaseTo(afterClosingTime);
    await gov.finalize();

    // check value after
    operator = await bridge.operator();
    assert.equal(operator, accounts[1]);
  });

  it('should allow to cancel proposal', async () => {
    // check value before
    let operator = await bridge.operator();
    assert.equal(operator, '0x0000000000000000000000000000000000000000');
    // propose and finalize value change
    const data = await bridge.contract.setOperator.getData(accounts[1]);
    await gov.propose(bridge.address, data);
    await gov.cancel(1);
    await gov.finalize();

    // check value after
    operator = await bridge.operator();
    assert.equal(operator, '0x0000000000000000000000000000000000000000');
  })

});
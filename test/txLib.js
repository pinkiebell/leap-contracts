
/**
 * Copyright (c) 2017-present, Parsec Labs (parseclabs.org)
 *
 * This source code is licensed under the Mozilla Public License, version 2,
 * found in the LICENSE file in the root directory of this source tree.
 */

import utils from 'ethereumjs-util';
import EVMRevert from './helpers/EVMRevert';
import { Period, Block, Tx, Input, Output, Outpoint, Type } from 'parsec-lib';
import chai from 'chai';
const TxMock = artifacts.require('./mocks/TxMock.sol');
  const EMPTY =  '0x0000000000000000000000000000000000000000000000000000000000000000';

const should = chai
  .use(require('chai-as-promised'))
  .should();

function toInt(str) {
  const buf = Buffer.from(str.replace('0x', ''), 'hex');
  return buf.readUInt32BE(28);
}

function toAddr(str) {
  const buf = Buffer.from(str.replace('0x', ''), 'hex');
  return `0x${buf.slice(12, 32).toString('hex')}`;
}

function fromInt(num) {
  const buf = Buffer.alloc(32, 0);
  buf.writeUInt32BE(num, 28);
  return buf;
}

function checkParse(rsp, txn) {
  // transaction header
  assert.equal(rsp[0], txn.type);
  if (txn.type == Type.DEPOSIT) {
    txn.inputs = [{prevout: {hash: fromInt(txn.options.depositId)}}];
  }
  assert.equal(toInt(rsp[1][0]), txn.inputs.length);  
  assert.equal(toInt(rsp[1][1]), txn.outputs.length);
  // inputs
  for (let i = 0; i < txn.inputs.length; i++) {
    assert.equal(rsp[1][2 + i * 5], `0x${txn.inputs[i].prevout.hash.toString('hex')}`);
    assert.equal(toInt(rsp[1][3 + i * 5]), i); // output position
    if (txn.type === Type.TRANSFER || ((txn.type === Type.COMP_RSP || txn.type === Type.COMP_REQ) && i > 0)) {
      assert.equal(rsp[1][4 + i * 5], `0x${txn.inputs[i].r.toString('hex')}`);
      assert.equal(rsp[1][5 + i * 5], `0x${txn.inputs[i].s.toString('hex')}`);
      assert.equal(toInt(rsp[1][6 + i * 5]), txn.inputs[i].v);
    } else  {
      assert.equal(rsp[1][4 + i * 5], EMPTY);
      assert.equal(rsp[1][5 + i * 5], EMPTY);
      assert.equal(toInt(rsp[1][6 + i * 5]), 0);
    }
  }
  // outputs
  for (let i = 0; i < txn.outputs.length; i++) {
    assert.equal(toInt(rsp[1][2 + txn.inputs.length * 5 + i * 5]), txn.outputs[i].value);
    assert.equal(toInt(rsp[1][3 + txn.inputs.length * 5 + i * 5]), txn.outputs[i].color);
    assert.equal(toAddr(rsp[1][4 + txn.inputs.length * 5 + i * 5]), txn.outputs[i].address.toLowerCase());
    if (txn.type === Type.COMP_RSP && i === 0) {
      assert.equal(toInt(rsp[1][5 + txn.inputs.length * 5 + i * 5]), 0); // gas price
      assert.equal(rsp[1][6 + txn.inputs.length * 5 + i * 5], tx.outputs[i].storageRoot); // storage root    
    } else if (txn.type === Type.COMP_REQ && i === 0) {
      assert.equal(toInt(rsp[1][5 + txn.inputs.length * 5 + i * 5]), txn.outputs[i].gasPrice); // gas price
      assert.equal(rsp[2], `0x${txn.outputs[i].msgData.toString('hex')}`); // gas price
    } else {
      assert.equal(toAddr(rsp[1][5 + txn.inputs.length * 5 + i * 5]), 0); // gas price
      assert.equal(rsp[1][6 + txn.inputs.length * 5 + i * 5], EMPTY); // storage root    
    }
  }
}

contract('TxLib', (accounts) => {
  const alice = accounts[0];
  const alicePriv = '0x278a5de700e29faae8e40e366ec5012b5ec63d36ec77e8a2417154cc1d25383f';
  const bob = accounts[1];
  const bobPriv = '0x7bc8feb5e1ce2927480de19d8bc1dc6874678c016ae53a2eec6a6e9df717bfac';
  const charlie = accounts[2];
  const prevTx = '0x7777777777777777777777777777777777777777777777777777777777777777';
  const value = 99000000;
  const color = 1337;

  describe('Parser', function() {
    let txLib;

    before(async () => {
      txLib = await TxMock.new();
    });

    describe('Deposit', function() {

      it('should allow to parse deposit', async () => {
        const deposit = Tx.deposit(12, value, bob, color);
        const block = new Block(32);
        block.addTx(deposit);
        const period = new Period(alicePriv, [block]);
        const proof = period.proof(deposit);

        const rsp = await txLib.parse(proof).should.be.fulfilled;
        checkParse(rsp, deposit);
      });

    });

    describe('Transfer', function() {

      it('should parse single input and output', async () => {
        const transfer = Tx.transfer(
          [new Input(new Outpoint(prevTx, 0))],
          [new Output(value, bob, color)],
        );
        transfer.sign([alicePriv]);
        const block = new Block(32);
        block.addTx(transfer);
        const period = new Period(alicePriv, [block]);
        const proof = period.proof(transfer);

        const rsp = await txLib.parse(proof).should.be.fulfilled;
        checkParse(rsp, transfer);
      });

      it('should parse 2 inputs and 2 outputs', async () => {
        const transfer = Tx.transfer([
          new Input(new Outpoint(prevTx, 0)),
          new Input(new Outpoint(prevTx, 1)),
        ],[
          new Output(value / 2, alice, color),
          new Output(value / 2, bob, color),
        ]);
        transfer.sign([bobPriv, alicePriv]);
        const block = new Block(32);
        block.addTx(transfer);
        const period = new Period(alicePriv, [block]);
        const proof = period.proof(transfer);

        const rsp = await txLib.parse(proof).should.be.fulfilled;
        checkParse(rsp, transfer);
      });

      it('should parse 1 inputs and 3 outputs', async () => {
        const transfer = Tx.transfer([
          new Input(new Outpoint(prevTx, 0)),
        ],[
          new Output(value / 3, alice, color),
          new Output(value / 3, bob, color),
          new Output(value / 3, charlie, color),
        ]);
        transfer.sign([bobPriv]);
        const block = new Block(32);
        block.addTx(transfer);
        const period = new Period(alicePriv, [block]);
        const proof = period.proof(transfer);

        const rsp = await txLib.parse(proof).should.be.fulfilled;
        checkParse(rsp, transfer);   
      });
    });

    describe('Consolidate', function() {

      it('should allow to parse consolidate tx', async () => {
        const consolidate = Tx.consolidate([
          new Input(new Outpoint(prevTx, 0)),
          new Input(new Outpoint(prevTx, 1)),
        ],
          new Output(value, alice, color),
        );
        const block = new Block(32);
        block.addTx(consolidate);
        const period = new Period(alicePriv, [block]);
        const proof = period.proof(consolidate);

        const rsp = await txLib.parse(proof).should.be.fulfilled;
        checkParse(rsp, consolidate);   
      });

      it('should fail to validate consolidate with only 1 input', async () => {
        const consolidate = Tx.consolidate([
          new Input(new Outpoint(prevTx, 0)),
        ],
          new Output(value, alice, color),
        );
        const block = new Block(32);
        block.addTx(consolidate);
        const period = new Period(alicePriv, [block]);
        const proof = period.proof(consolidate);
        await txLib.parse(proof).should.be.rejectedWith(EVMRevert);
      });
    });

    describe('Computation Request', function() {
      it('should parse with 1 output', async () => {
        const compRequest = Tx.compRequest([
          new Input({
            prevout: new Outpoint(prevTx, 0),
          }),
          new Input(new Outpoint(prevTx, 1)),
        ],[
          new Output({
            value: value / 2,
            color,
            address: alice,
            gasPrice: 123,
            msgData: '0x1234',
        })]);
        compRequest.sign([_, alicePriv]);
        const block = new Block(32);
        block.addTx(compRequest);
        const period = new Period(alicePriv, [block]);
        const proof = period.proof(compRequest);

        const rsp = await txLib.parse(proof).should.be.fulfilled;
        checkParse(rsp, compRequest);
      });
    });

    describe('Computation Response', function() {
      it('should parse with 1 output', async () => {
        const compResponse = Tx.compResponse([
          new Input(new Outpoint(prevTx, 0)),
        ],[
          new Output({
            value,
            color,
            address: alice,
            storageRoot: alicePriv,
        })]);
        const block = new Block(32);
        block.addTx(compResponse);
        const period = new Period(alicePriv, [block]);
        const proof = period.proof(compResponse);

        const rsp = await txLib.parse(proof).should.be.fulfilled;
        checkParse(rsp, compResponse);
      });
    });
  });
  describe('Utils', function() {
    let txLib;

    before(async () => {
      txLib = await TxMock.new();
    });

    it('should allow to verify proof', async () => {
      const blocks = [];
      let block;

      for (let i = 0; i < 32; i ++) {
        block = new Block(i).addTx(Tx.deposit(i, value, bob, color));
        blocks.push(block);
      }
      const period = new Period(alicePriv, blocks);
      const proof = period.proof(Tx.deposit(12, value, bob, color));
      await txLib.validateProof(proof).should.be.fulfilled;
    });

    it('should allow to verify proof with always 2 txnns', async () => {
      const blocks = [];
      let block;
      for (let i = 0; i < 32; i ++) {
        block = new Block(i).addTx(Tx.deposit(i, value, bob, color)).addTx(Tx.deposit(100 + i, value, bob, color));
        blocks.push(block);
      }
      const period = new Period(alicePriv, blocks);
      const proof = period.proof(Tx.deposit(12, value, bob, color));
      await txLib.validateProof(proof).should.be.fulfilled;
    });
  });
});

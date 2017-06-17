var EventEmitter = require('events').EventEmitter;
var assert = require('chai').assert;
var sinon = require('sinon');
var SenderLink = require('../lib/sender_link.js').SenderLink;
var AmqpMessage = require('../lib/amqp_message.js').AmqpMessage;

describe('SenderLink', function() {
  describe('attach', function() {
    it('fails messages in the queue with its own error if the link cannot be attached', function (testCallback) {
      var fakeLinkObj = new EventEmitter();
      var fakeError = new Error('fake error');
      var fakeAmqp10Client = new EventEmitter();
      var message1Failed = false;
      var message2Failed = false;
      var unlockReject = null;
      fakeAmqp10Client.createSender = function () {
        return new Promise(function (resolve, reject) {
          unlockReject = reject; // will lock the state machine into 'attaching' until we can reject.
        });
      };

      var link = new SenderLink('link', {}, fakeAmqp10Client);
      link.attach(function(err) {
        assert.isTrue(message1Failed);
        assert.isTrue(message2Failed);
        assert.strictEqual(err, fakeError);
      });
      link.send(new AmqpMessage(''), function (err) {
        message1Failed = true;
        assert.strictEqual(err, fakeError);
      });
      link.send(new AmqpMessage(''), function (err) {
        message2Failed = true;
        assert.strictEqual(err, fakeError);
        testCallback();
      });
      unlockReject(fakeError);
    });
  });

  describe('send', function() {
    it('automatically attaches the link if it is detached', function(testCallback) {
      var fakeLinkObj = new EventEmitter();
      fakeLinkObj.send = sinon.stub().resolves();
      var fakeAmqp10Client = new EventEmitter();
      fakeAmqp10Client.createSender = sinon.stub().resolves(fakeLinkObj);

      var link = new SenderLink('link', {}, fakeAmqp10Client);
      link.send(new AmqpMessage(''), function() {
        assert(fakeAmqp10Client.createSender.calledOnce);
        assert(fakeLinkObj.send.calledOnce);
        testCallback();
      });
    });

    it('sends the message passed as argument and calls the callback if successful', function(testCallback) {
      var fakeMessage = new AmqpMessage({});
      var fakeLinkObj = new EventEmitter();
      fakeLinkObj.send = sinon.stub().resolves();
      var fakeAmqp10Client = new EventEmitter();
      fakeAmqp10Client.createSender = sinon.stub().resolves(fakeLinkObj);

      var link = new SenderLink('link', {}, fakeAmqp10Client);
      link.attach(function() {
        link.send(fakeMessage, function() {
          assert(fakeLinkObj.send.calledWith(fakeMessage));
          testCallback();
        });
      });
    });

    it('queues messages and send them in order when the link is attached', function(testCallback) {
      var fakeMessage1 = new AmqpMessage({});
      var fakeMessage2 = new AmqpMessage({});
      var fakeLinkObj = new EventEmitter();
      var unlockResolve = null;
      fakeLinkObj.send = sinon.stub().resolves();
      var fakeAmqp10Client = new EventEmitter();
      fakeAmqp10Client.createSender = function() {
        return new Promise(function(resolve, reject) {
          unlockResolve = resolve;
        });
      };

      var link = new SenderLink('link', {}, fakeAmqp10Client);
      link.attach(function() {}); // Will be stuck in attaching until unlockResolve is called.
      link.send(fakeMessage1, function() {});
      link.send(fakeMessage2, function() {
        assert(fakeLinkObj.send.firstCall.calledWith(fakeMessage1));
        assert(fakeLinkObj.send.secondCall.calledWith(fakeMessage2));
        testCallback();
      });
      unlockResolve(fakeLinkObj);
    });

    it('calls the callback with an error if the amqp10 link fails to send the message', function (testCallback) {
      var fakeMessage = new AmqpMessage({});
      var fakeLinkObj = new EventEmitter();
      var fakeError = new Error('fake send failure');
      fakeLinkObj.send = sinon.stub().rejects(fakeError);
      var fakeAmqp10Client = new EventEmitter();
      fakeAmqp10Client.createSender = sinon.stub().resolves(fakeLinkObj);

      var link = new SenderLink('link', {}, fakeAmqp10Client);
      link.attach(function() {
        link.send(fakeMessage, function(err) {
          assert.strictEqual(err, fakeError);
          testCallback();
        });
      });
    });
  });
});
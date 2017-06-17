var EventEmitter = require('events').EventEmitter;
var assert = require('chai').assert;
var sinon = require('sinon');
var ReceiverLink = require('../lib/receiver_link.js').ReceiverLink;
var AmqpMessage = require('../lib/amqp_message.js').AmqpMessage;

describe('ReceiverLink', function() {
  [{
    recvLinkMethod: 'accept',
    amqp10LinkMethod: 'accept'
  },
  {
    recvLinkMethod: 'complete',
    amqp10LinkMethod: 'accept'
  },
  {
    recvLinkMethod: 'reject',
    amqp10LinkMethod: 'reject'
  },
  {
    recvLinkMethod: 'abandon',
    amqp10LinkMethod: 'abandon'
  },
  ].forEach(function (testConfig) {
    describe(testConfig.recvLinkMethod, function() {
      [undefined, null].forEach(function (falsyMessage) {
        it('throws a ReferenceError if the message object is \'' +  + '\'', function() {
          var link = new ReceiverLink('link', {}, {});
          assert.throws(function(){
            link[testConfig.recvLinkMethod](falsyMessage, function() {});
          }, ReferenceError);
        });
      });

      it('automatically attaches the link if it is detached', function(testCallback) {
        var fakeLinkObj = new EventEmitter();
        fakeLinkObj[testConfig.amqp10LinkMethod] = sinon.stub().resolves();
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = sinon.stub().resolves(fakeLinkObj);

        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        link[testConfig.recvLinkMethod](new AmqpMessage(''), function() {
          assert(fakeAmqp10Client.createReceiver.calledOnce);
          assert(fakeLinkObj[testConfig.amqp10LinkMethod].calledOnce);
          testCallback();
        });
      });

      it(testConfig.amqp10LinkMethod + 's the message passed as argument and calls the callback if successful', function(testCallback) {
        var fakeMessage = new AmqpMessage({});
        fakeMessage.transportObj = {};
        var fakeLinkObj = new EventEmitter();
        fakeLinkObj[testConfig.amqp10LinkMethod] = sinon.stub().resolves();
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = sinon.stub().resolves(fakeLinkObj);

        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        link.attach(function() {
          link[testConfig.recvLinkMethod](fakeMessage, function() {
            assert(fakeLinkObj[testConfig.amqp10LinkMethod].calledWith(fakeMessage.transportObj));
            testCallback();
          });
        });
      });

      it('queues messages and ' + testConfig.amqp10LinkMethod + ' them in order when the link is attached', function(testCallback) {
        var fakeMessage1 = new AmqpMessage({});
        fakeMessage1.transportObj = {};
        var fakeMessage2 = new AmqpMessage({});
        fakeMessage2.transportObj = {};
        var fakeLinkObj = new EventEmitter();
        var unlockResolve = null;
        fakeLinkObj[testConfig.amqp10LinkMethod] = sinon.stub().resolves();
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = function() {
          return new Promise(function(resolve, reject) {
            unlockResolve = resolve;
          });
        };

        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        link.attach(function() {}); // Will be stuck in attaching until unlockResolve is called.
        link[testConfig.recvLinkMethod](fakeMessage1, function() {});
        link[testConfig.recvLinkMethod](fakeMessage2, function() {
          assert(fakeLinkObj[testConfig.amqp10LinkMethod].firstCall.calledWith(fakeMessage1.transportObj));
          assert(fakeLinkObj[testConfig.amqp10LinkMethod].secondCall.calledWith(fakeMessage2.transportObj));
          testCallback();
        });
        unlockResolve(fakeLinkObj);
      });

      it('doesn\'t crash if no callback is provided', function() {
        var fakeMessage = new AmqpMessage({});
        fakeMessage.transportObj = {};
        var fakeLinkObj = new EventEmitter();
        fakeLinkObj[testConfig.amqp10LinkMethod] = sinon.stub().resolves();
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = sinon.stub().resolves(fakeLinkObj);

        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        link.attach(function() {
          link[testConfig.recvLinkMethod](fakeMessage);
          assert(fakeLinkObj[testConfig.amqp10LinkMethod].calledWith(fakeMessage.transportObj));
        });
      });

      it('calls the callback with an error if the link cannot be attached', function(testCallback) {
        var fakeError = new Error('fake error');
        var fakeMessage = new AmqpMessage({});
        fakeMessage.transportObj = {};
        var fakeLinkObj = new EventEmitter();
        fakeLinkObj[testConfig.amqp10LinkMethod] = sinon.stub().resolves();
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = sinon.stub().rejects(fakeError);

        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        link.on('error', function() {});
        link[testConfig.recvLinkMethod](fakeMessage, function(err) {
          assert.strictEqual(err, fakeError);
          testCallback();
        });
      });
    });
  });

  describe('events', function() {
    describe('message', function() {
      it('attaches the link when subscribing to the \'message\' event', function() {
        var fakeLinkObj = new EventEmitter();
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = sinon.stub().resolves(fakeLinkObj);
        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        link.on('message', function() {});
        assert(fakeAmqp10Client.createReceiver.calledOnce);
      });

      it('emits an error if attaching the link fails while subscribing to the \'message\' event', function(testCallback) {
        var fakeError = new Error('fake error');
        var fakeLinkObj = new EventEmitter();
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = sinon.stub().rejects(fakeError);
        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        link.on('error', function(err) {
          assert(fakeAmqp10Client.createReceiver.calledOnce);
          assert.strictEqual(err, fakeError);
          testCallback();
        });
        link.on('message', function() {});
      });

      it('subscribes to the underlying amqp10 link events', function(testCallback) {
        var fakeLinkObj = new EventEmitter();
        sinon.spy(fakeLinkObj, 'on');
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = sinon.stub().resolves(fakeLinkObj);
        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        link.on('message', function() {});
        link.on('message', function() {});
        assert(fakeAmqp10Client.createReceiver.calledOnce);
        link._fsm.on('transition', function (transitionData) {
          if (transitionData.toState === 'attached') {
            assert(fakeLinkObj.on.calledWith('detached'));
            assert(fakeLinkObj.on.calledWith('errorReceived'));
            assert(fakeLinkObj.on.calledWith('message'));
            testCallback();
          }
        });
      });

      it('detaches the link if there are no subscribers left on the \'message\' event', function(testCallback) {
        var fakeLinkObj = new EventEmitter();
        sinon.spy(fakeLinkObj, 'on');
        fakeLinkObj.forceDetach = sinon.spy();
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = sinon.stub().resolves(fakeLinkObj);
        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        var listener1 = function() {};
        var listener2 = function() {};
        link.on('message', listener1);
        link.on('message', listener2);
        assert(fakeAmqp10Client.createReceiver.calledOnce);
        link._fsm.on('transition', function (transitionData) {
          if (transitionData.toState === 'attached') {
            link.removeListener('message', listener1);
            assert(fakeLinkObj.forceDetach.notCalled);
            link.removeListener('message', listener2);
          } else if (transitionData.toState === 'detached') {
            assert(fakeLinkObj.forceDetach.calledOnce);
            testCallback();
          }
        });
      });

      it('forwards the message event if subscribed', function(testCallback) {
        var amqpMessage = new AmqpMessage('');
        amqpMessage.properties = {};
        var fakeLinkObj = new EventEmitter();
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = sinon.stub().resolves(fakeLinkObj);
        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        link.attach(function() {
          link.on('message', function(msg) {
            assert.strictEqual(msg.transportObj, amqpMessage);
            testCallback();
          });
          fakeLinkObj.emit('message', amqpMessage);
        });
      });

      it('emits an error event if errorReceived is emitted by the underlying link', function(testCallback) {
        var fakeError = new Error('fake error');
        var fakeLinkObj = new EventEmitter();
        fakeLinkObj.forceDetach = function() {};
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = sinon.stub().resolves(fakeLinkObj);
        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        link.attach(function() {
          link.on('error', function(err) {
            assert.strictEqual(err, fakeError);
            testCallback();
          });
          fakeLinkObj.emit('errorReceived', fakeError);
        });
      });

      it('emits an error event if the underlying link is detached with an error', function(testCallback) {
        var fakeError = new Error('fake error');
        var fakeLinkObj = new EventEmitter();
        fakeLinkObj.forceDetach = function() {};
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client.createReceiver = sinon.stub().resolves(fakeLinkObj);
        var link = new ReceiverLink('link', {}, fakeAmqp10Client);
        link.attach(function() {
          link.on('error', function(err) {
            assert.strictEqual(err, fakeError);
            testCallback();
          });
          fakeLinkObj.emit('detached', { closed: true, error: fakeError });
        });
      });
    });
  });
});
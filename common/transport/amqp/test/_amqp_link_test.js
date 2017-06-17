var EventEmitter = require('events').EventEmitter;
var assert = require('chai').assert;
var sinon = require('sinon');
var ReceiverLink = require('../lib/receiver_link.js').ReceiverLink;
var SenderLink = require('../lib/sender_link.js').SenderLink;
var AmqpMessage = require('../lib/amqp_message.js').AmqpMessage;

[
  {
    linkClass: ReceiverLink,
    amqp10Method: 'createReceiver'
  },
  {
    linkClass: SenderLink,
    amqp10Method: 'createSender'
  }
].forEach(function(testConfig) {
  describe(testConfig.linkClass.name, function() {
    describe('constructor', function() {
      it('inherits from EventEmitter', function() {
        var link = new testConfig.linkClass('link', null, {});
        assert.instanceOf(link, EventEmitter);
      });

      it('implements the AmqpLink interface', function() {
        var link = new testConfig.linkClass('link', null, {});
        assert.isFunction(link.attach);
        assert.isFunction(link.detach);
      });

      it('initializes the internal state machine to a \'detached\' state', function() {
        var link = new testConfig.linkClass('link', null, {});
        assert.strictEqual(link._fsm.state, 'detached');
      });
    });

    describe('attach', function() {
      it('attaches a new link using the amqp10.AmqpClient object', function(testCallback) {
        var fakeLinkAddress = 'link';
        var fakeLinkOptions = {};
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client[testConfig.amqp10Method] = sinon.stub().resolves(new EventEmitter());

        var link = new testConfig.linkClass(fakeLinkAddress, fakeLinkOptions, fakeAmqp10Client);
        link.attach(function() {
          assert(fakeAmqp10Client[testConfig.amqp10Method].calledWith(fakeLinkAddress, fakeLinkOptions));
          testCallback();
        });
      });

      it('does not create a new link if already attached', function(testCallback) {
        var fakeLinkObj = new EventEmitter();
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client[testConfig.amqp10Method] = sinon.stub().resolves(fakeLinkObj);

        var link = new testConfig.linkClass('link', null, fakeAmqp10Client);
        link.attach(function() {
          // now successfully attached
          assert.isTrue(fakeAmqp10Client[testConfig.amqp10Method].calledOnce);
          link.attach(function() {
            assert.isTrue(fakeAmqp10Client[testConfig.amqp10Method].calledOnce); // would be false if createReceiver had been called twice
            testCallback();
          });
        });
      });

      it('calls the callback with an error if attaching the link fails', function(testCallback) {
        var fakeError = new Error('fake error');
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client[testConfig.amqp10Method] = sinon.stub().rejects(fakeError);

        var link = new testConfig.linkClass('link', null, fakeAmqp10Client);
        link.attach(function(err) {
          assert.strictEqual(err, fakeError);
          testCallback();
        });
      });

      it('calls the callback with an error if the client emits an error while attaching the link', function(testCallback) {
        var fakeError = new Error('fake error');
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client[testConfig.amqp10Method] = function () {
          return new Promise(function(resolve, reject) {
            fakeAmqp10Client.emit('client:errorReceived', fakeError);
            resolve(new EventEmitter());
          });
        };

        var link = new testConfig.linkClass('link', null, fakeAmqp10Client);
        link.attach(function(err) {
          assert.strictEqual(err, fakeError);
          testCallback();
        });
      });

      it('subscribes to the detach and errorReceived events', function(testCallback) {
        var fakeLinkObj = new EventEmitter();
        sinon.spy(fakeLinkObj, 'on');
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client[testConfig.amqp10Method] = sinon.stub().resolves(fakeLinkObj);

        var link = new testConfig.linkClass('link', {}, fakeAmqp10Client);
        link.attach(function() {
          assert(fakeLinkObj.on.calledWith('detached'));
          assert(fakeLinkObj.on.calledWith('errorReceived'));
          testCallback();
        });
      });
    });

    describe('detach', function() {
      it('detaches the link if it is attached', function(testCallback) {
        var fakeLinkObj = new EventEmitter();
        fakeLinkObj.forceDetach = sinon.stub();
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client[testConfig.amqp10Method] = sinon.stub().resolves(fakeLinkObj);

        var link = new testConfig.linkClass('link', {}, fakeAmqp10Client);
        link.attach(function() {
          link.detach();
          assert(fakeLinkObj.forceDetach.calledOnce);
          testCallback();
        });
      });

      it('does not do anything if the link is already detached', function() {
        var fakeAmqp10Client = new EventEmitter();
        fakeAmqp10Client[testConfig.amqp10Method] = function () { assert.fail('should not try to create a receiver'); };

        var link = new testConfig.linkClass('link', {}, fakeAmqp10Client);
        link.detach();
      });
    });

    describe('events', function() {
      describe('error', function() {});
      describe('detached', function() {
        it('returns to the detached state when the detached event is received', function(testCallback) {
          var fakeLinkObj = new EventEmitter();
          fakeLinkObj.forceDetach = function() {};
          var fakeError = new Error('link is now detached');
          var fakeAmqp10Client = new EventEmitter();
          fakeAmqp10Client[testConfig.amqp10Method] = sinon.stub().resolves(fakeLinkObj);

          var link = new testConfig.linkClass('link', null, fakeAmqp10Client);
          link.attach(function() {
            // now successfully attached
            assert.isTrue(fakeAmqp10Client[testConfig.amqp10Method].calledOnce);
            fakeLinkObj.emit('detached', { });
            // now detached
            link.attach(function() {
              assert.isTrue(fakeAmqp10Client[testConfig.amqp10Method].calledTwice);
              testCallback();
            });
          });
        });
      });
    });
  });
});
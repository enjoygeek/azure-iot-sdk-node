import * as machina from 'machina';
import * as amqp10 from 'amqp10';
import * as dbg from 'debug';
import { EventEmitter } from 'events';
import { Message, results, errors } from 'azure-iot-common';
import { AmqpMessage } from './amqp_message';
import { AmqpLink } from './amqp_link_interface';
import { AmqpTransportError } from './amqp_common_errors';

const debug = dbg('ReceiverLink');

export class ReceiverLink  extends EventEmitter implements AmqpLink {
  private _linkAddress: string;
  private _linkOptions: any;
  private _linkObject: any;
  private _fsm: machina.Fsm;
  private _amqp10Client: amqp10.AmqpClient;
  private _messageQueue: {
    message: Message,
    settleMethod: string,
    callback: (err?: Error, result?: results.MessageEnqueued) => void
  }[];
  private _detachHandler: (detachEvent: any) => void;
  private _errorHandler: (err: Error) => void;
  private _messageHandler: (message: AmqpMessage) => void;

  constructor(linkAddress: string, linkOptions: any, amqp10Client: amqp10.AmqpClient) {
    super();
    this._linkAddress = linkAddress;
    this._linkOptions = linkOptions;
    this._amqp10Client = amqp10Client;
    this._messageQueue = [];

    this._detachHandler = (detachEvent: any): void => {
      this._fsm.transition('detaching', detachEvent.error);
    };

    this._errorHandler = (err: Error): void => {
      this._fsm.transition('detaching', err);
    };

    this._messageHandler = (message: AmqpMessage): void => {
      this.emit('message', AmqpMessage.toMessage(message));
    };

    const pushToQueue = (method, message, callback) => {
      this._messageQueue.push({
        settleMethod: method,
        message: message,
        callback: callback
      });
    };

    this._fsm = new machina.Fsm({
      initialState: 'detached',
      states: {
        detached: {
          _onEnter: (err) => {
            let toSettle = this._messageQueue.shift();
            while (toSettle) {
              toSettle.callback(err || new Error('Link was detached'));
              toSettle = this._messageQueue.shift();
            }

            if (err) {
              this.emit('error', err);
            }
          },
          attach: (callback) => {
            this._fsm.transition('attaching', callback);
          },
          detach: () => { return; },
          accept: (message, callback) => {
            pushToQueue('accept', message, callback);
            this._fsm.transition('attaching');
          },
          reject: (message, callback) => {
            pushToQueue('reject', message, callback);
            this._fsm.transition('attaching');
          },
          abandon: (message, callback) => {
            pushToQueue('abandon', message, callback);
            this._fsm.transition('attaching');
          }
        },
        attaching: {
          _onEnter: (callback) => {
            this._attachLink((err) => {
              let newState = err ? 'detached' : 'attached';
              if (callback) {
                this._fsm.transition(newState);
                callback(err);
              } else {
                this._fsm.transition(newState, err);
              }
            });
          },
          detach: () => this._fsm.transition('detaching'),
          accept: (message, callback) => pushToQueue('accept', message, callback),
          reject: (message, callback) => pushToQueue('reject', message, callback),
          abandon: (message, callback) => pushToQueue('abandon', message, callback)
        },
        attached: {
          _onEnter: () => {
            let toSettle = this._messageQueue.shift();
            while (toSettle) {
              this._fsm.handle(toSettle.settleMethod, toSettle.message, toSettle.callback);
              toSettle = this._messageQueue.shift();
            }
          },
          attach: (callback) => {
            if (callback) {
              return callback()
            }
          },
          detach: () => this._fsm.transition('detaching'),
          accept: (message, callback) => {
            this._linkObject.accept(message);
            if (callback) callback(null, new results.MessageCompleted());
          },
          reject: (message, callback) => {
            this._linkObject.reject(message);
            if (callback) callback(null, new results.MessageRejected());
          },
          abandon: (message, callback) => {
            this._linkObject.abandon(message);
            if (callback) callback(null, new results.MessageAbandoned());
          }
        },
        detaching: {
          _onEnter: (err) => {
            if (this._linkObject) {
              this._linkObject.removeListener('detached', this._detachHandler);
              this._linkObject.removeListener('message', this._messageHandler);
              this._linkObject.removeListener('errorReceived', this._errorHandler);
              this._linkObject.forceDetach();
              this._linkObject = null;
            }

            this._fsm.transition('detached', err);
          },
          '*': () => this._fsm.deferUntilTransition('detached')
        }
      }
    });

    this.on('removeListener', (eventName) => {
      // stop listening for AMQP events if our consumers stop listening for our events
      if (eventName === 'message' && this.listeners('message').length === 0) {
        this._fsm.handle('detach');
      }
    });

    this.on('newListener', (eventName) => {
      // lazy-init AMQP event listeners
      if (eventName === 'message') {
        this._fsm.handle('attach');
      }
    });
  }

  detach(): void {
    this._fsm.handle('detach');
  }

  attach(callback: (err?: Error) => void): void {
    this._fsm.handle('attach', callback);
  }

  accept(message: Message, callback?: (err?: Error, result?: results.MessageCompleted) => void): void {
    if (!message) { throw new ReferenceError('Invalid message object.'); }
    this._fsm.handle('accept', message.transportObj, callback);
  }

  complete(message: Message, callback?: (err?: Error, result?: results.MessageCompleted) => void): void {
    this.accept(message, callback);
  }

  reject(message: Message, callback?: (err?: Error, result?: results.MessageRejected) => void): void {
    if (!message) { throw new ReferenceError('Invalid message object.'); }
    this._fsm.handle('reject', message.transportObj, callback);
  }

  abandon(message: Message, callback?: (err?: Error, result?: results.MessageAbandoned) => void): void {
    if (!message) { throw new ReferenceError('Invalid message object.'); }
    this._fsm.handle('abandon', message.transportObj, callback);
  }

  private _attachLink(done: (err?: Error) => void): void {
    /*Codes_SRS_NODE_COMMON_AMQP_16_033: [The `attachReceiverLink` method shall call the `done` callback with a `NotConnectedError` object if the amqp client is not connected when the method is called.]*/
    let connectionError = null;
    let clientErrorHandler = (err) => {
      connectionError = err;
    };
    /*Codes_SRS_NODE_COMMON_AMQP_16_007: [If send encounters an error before it can send the request, it shall invoke the `done` callback function and pass the standard JavaScript Error object with a text description of the error (err.message).]*/
    this._amqp10Client.on('client:errorReceived', clientErrorHandler);

    /*Codes_SRS_NODE_COMMON_AMQP_06_004: [The `attachReceiverLink` method shall create a policy object that contain link options to be merged if the linkOptions argument is not falsy.]*/
    /*Codes_SRS_NODE_COMMON_AMQP_16_018: [The `attachReceiverLink` method shall call `createReceiver` on the `amqp10` client object.]*/
    this._amqp10Client.createReceiver(this._linkAddress, this._linkOptions)
      .then((amqp10link) => {
        amqp10link.on('detached', (detached) => {
          debug('receiver link detached: ' + this._linkAddress);
        });
        this._amqp10Client.removeListener('client:errorReceived', clientErrorHandler);
        if (!connectionError) {
          debug('Receiver object created for endpoint: ' + this._linkAddress);
          this._linkObject = amqp10link;
          this._linkObject.on('detached', this._detachHandler);
          this._linkObject.on('errorReceived', this._errorHandler);
          this._linkObject.on('message', this._messageHandler);
          /*Codes_SRS_NODE_COMMON_AMQP_16_020: [The `attachReceiverLink` method shall call the `done` callback with a `null` error and the link object that was created if the link was attached successfully.]*/
          this._safeCallback(done);
        } else {
          /*Codes_SRS_NODE_COMMON_AMQP_16_021: [The `attachReceiverLink` method shall call the `done` callback with an `Error` object if the link object wasn't created successfully.]*/
          this._safeCallback(done, connectionError);
        }

        return null;
      })
      .catch((err) => {
        /*Codes_SRS_NODE_COMMON_AMQP_16_021: [The `attachReceiverLink` method shall call the `done` callback with an `Error` object if the link object wasn't created successfully.]*/
        this._safeCallback(done, err);
      });
  }

  /*Codes_SRS_NODE_COMMON_AMQP_16_011: [All methods should treat the `done` callback argument as optional and not throw if it is not passed as argument.]*/
  private _safeCallback(callback: (err?: Error, result?: any) => void, error?: Error | null, result?: any): void {
    if (callback) {
      process.nextTick(() => callback(error, result));
    }
  }
}

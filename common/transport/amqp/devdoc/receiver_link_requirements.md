# ReceiverLink Requirements

## Overview

The `ReceiverLink` class is internal to the SDK and shall be considered private. It shall not be used directly by clients of the SDK, who should instead rely on the higher-level constructs (`Client` classes provided by `azure-iot-device` and `azure-iothub`).

The `ReceiverLink` class implements a state machine that manages the underlying `amqp10` link object used to receive messages from IoT Hub. It can be attached and detached manually, and will try to attach automatically if not already attached when setting up a message listener or trying to settle an existing message.

## Example usage

```typescript
import * as amqp10 from 'amqp10';
import { AmqpMessage } from './ampq_message';

const linkAddress = 'exampleAddress';
const amqp10Client = new amqp10.AmqpClient(null);

const receiverLink = new ReceiverLink(linkAddress, null, amqp10Client);
receiverLink.on('error', (err) => {
  console.error(err.toString());
});

receiverLink.on('message', (msg) => {
  console.log(msg.body);
  receiverLink.accept(msg, (err) => {
    if (err) {
      console.error(err.toString());
    } else {
      console.log('message successfully settled (accept)');
    }
  });
});
```

## Public Interface

### constructor(linkAddress: string, linkOptions: any, amqp10Client: amqp10.AmqpClient)

The `ReceiverLink` internal state machine shall be initialized in the `detached` state.

The `ReceiverLink` class shall inherit from `EventEmitter`.

The `ReceiverLink` class shall implement the `AmqpLink` interface.

### attach(callback: (err?: Error) => void): void

The `attach` method shall use the stored instance of the `amqp10.AmqpClient` object to attach a new link object with the `linkAddress` and `linkOptions` provided when creating the `ReceiverLink` instance.

If the `amqp10.AmqpClient` emits an `errorReceived` event during the time the link is attached, the `callback` function shall be called with this error.

The `ReceiverLink` object should subscribe to the `detached` event of the newly created `amqp10` link object.

The `ReceiverLink` object should subscribe to the `errorReceived` event of the newly created `amqp10` link object.

If the `amqp10.AmqpClient` fails to create the link the `callback` function shall be called with this error object.

### detach(): void

The `detach` method shall detach the link created by the `amqp10.AmqpClient` underlying object.

### accept(message: AmqpMessage, callback: (err?: Error, result?: results.MessageAccepted) => void): void

The `accept` method shall use the link created by the underlying `amqp10.AmqpClient` to settle the specified `message` with IoT hub by accepting it.

If the state machine is not in the `attached` state, the `ReceiverLink` object shall attach the link first and then send the message.

### complete(message: AmqpMessage, callback: (err?: Error, result?: results.MessageAccepted) => void): void

The `complete` method shall call the `accept` method with the same arguments (it is here for backward compatibility purposes only).

### reject(message: AmqpMessage, callback: (err?: Error, result?: results.MessageRejected) => void): void

The `reject` method shall use the link created by the underlying `amqp10.AmqpClient` to settle the specified `message` with IoT hub by rejecting it.

If the state machine is not in the `attached` state, the `ReceiverLink` object shall attach the link first and then send the message.

### abandon(message: AmqpMessage, callback: (err?: Error, result?: results.MessageAbandoned) => void): void

The `abandon` method shall use the link created by the underlying `amqp10.AmqpClient` to settle the specified `message` with IoT hub by abandoning it.

If the state machine is not in the `attached` state, the `ReceiverLink` object shall attach the link first and then send the message.

### Events

If a `detached` event is emitted by the `ampq10` link object, the `ReceiverLink` object shall return to the `detached` state.

If an `errorReceived` event is emitted by the `amqp10` link object, the `ReceiverLink` object shall emit an `error` event with this error.

If a `message` event is emitted by the `amqp10` link object, the `ReceiverLink` object shall emit a `message` event with the same content.

### Internal state machine

While the link isn't attached, the messages passed to the `accept`, `complete`, `reject`, and `abandon` methods shall be queued.

When the link gets attached, the message shall be settled in the order they were queued.

If the link fails to attach and there are messages in the queue, the callback for each message shall be called with the error that caused the detach in the first place.

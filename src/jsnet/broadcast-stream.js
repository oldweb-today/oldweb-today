// Copyright 2018 The Emulation-as-a-Service Authors.
// SPDX-License-Identifier: GPL-2.0-or-later

export const broadcastStream = (name) => {
    const channel = new BroadcastChannel(name);
    let writableClosed, readableClosed;
    const closed = Promise.all([
        new Promise(r => writableClosed = r),
        new Promise(r => readableClosed = r).then(() => channel.onmessage = null),
    ]).then(() => channel.close());
    const writable = new WritableStream({
        write(ch) {
            channel.postMessage(ch);
        },
        close() {
            writableClosed();
        },
        abort() {
            writableClosed();
        },
    });
    let readController;
    const readable = new ReadableStream({
        start(c) {
            readController = c;
        },
        cancel() {
            readableClosed();
        },
    });
    channel.onmessage = ({data}) => readController.enqueue(data);
    return {writable, readable};
};

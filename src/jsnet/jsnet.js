// Parts Copyright 2018 The Emulation-as-a-Service Authors.
// SPDX-License-Identifier: GPL-2.0-or-later

// Parts Copyright Webrecorder Software
// AGPL3

import "./streams-polyfills.js";

import {broadcastStream} from "./broadcast-stream.js";
import {NIC} from "./webnetwork.js";

import {EthernetParser, IPv4Parser} from "./network-parser.js";
import TransformStream from "./transform-stream.js";

import RingBuffer from "sab-ring-buffer/ringbuffer.js";

import HttpProxyServer from './httpproxyserver';

const DEBUG = false;


const iterator = reader => ({
    [Symbol.asyncIterator]: function () {return this;},
    next: () => reader.read(),
    return: () => ({}),
});

function sleep(timeout) {
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

let replayUrl;
let replayTs;
let proxyIP = "192.168.1.1";
let proxyPort = 8080;
let homePage = "http://192.168.1.1:8080/";
let pollSAB = false;

// for adding ARP entry
let clientMAC = null;
let clientIP = null;
let rb = null;
let emuPort = null;

let pingOnUpdate = false;

function updateState(data) {
  if (data.replayUrl !== undefined) {
    replayUrl = data.replayUrl;
  }
  if (data.replayTs !== undefined) {
    replayTs = data.replayTs;
  }
  if (data.proxyIP !== undefined) {
    proxyIP = data.proxyIP;
  }
  if (data.proxyPort !== undefined) {
    proxyPort = data.proxyPort;
  }
  homePage = `http://${proxyIP}:${proxyPort}/`;
  pingOnUpdate = true;
}

self.onmessage = (event) => {
  if (event.data.clientIP) {
    clientIP = event.data.clientIP;
  }
  if (event.data.clientMAC) {
    clientMAC = event.data.clientMAC;
  }
  if (event.data.pollSAB) {
    pollSAB = event.data.pollSAB;
    rb = RingBuffer.create(1514 * 256);
    if (event.data.port) {
      emuPort = event.data.port;
      emuPort.postMessage(rb.buffer);
    }
  }

  updateState(event.data);
  main();
};

const updateProxy = new BroadcastChannel("update-proxy");
updateProxy.onmessage = (event) => {
  updateState(event.data);
};

const sabWriter = new WritableStream({
  async write(chunk) {
    let waitCount = 0;

    while (true) {
      if (rb.remaining >= chunk.byteLength + 2) {
        const sizeBuff = new ArrayBuffer(2);
        new DataView(sizeBuff).setUint16(0, chunk.byteLength);
        rb.append(new Uint8Array(sizeBuff));
        rb.append(chunk);
        return true;
      } else {
        waitCount++;
        await sleep(100);
        if (waitCount > 50) {
          console.warn("Dropping packets due to backup");
          rb.clear();
        }
      }
    }
  }
});

function updateCallback() {
  if (pingOnUpdate) {
    updateProxy.postMessage({done: true});
    pingOnUpdate = false;
  }
}


async function main() {
  const nic = await new NIC(undefined, new Uint8Array([34, 250, 80, 37, 2, 130]));

  nic.readable.pipeThrough(broadcastStream("eth_to_emu"));

  broadcastStream("eth_from_emu").readable.pipeThrough(nic);

  if (DEBUG) {
    monitorChannel("eth_from_emu", " -> ");
    monitorChannel("eth_to_emu", " <- ");
  }

  if (pollSAB) {
    broadcastStream("eth_to_emu").readable.pipeTo(sabWriter);
  }

  nic.addIPv4(proxyIP);

  nic.startDHCPServer(proxyIP, "255.255.255.0");

  if (clientIP && clientMAC) {
    console.log("Adding ARP Entry", clientIP, clientMAC);
    nic.addARPEntry(new Uint8Array(clientMAC), new Uint8Array(clientIP));
  }

  const server = new nic.TCPServerSocket({localPort: proxyPort, localAddress: proxyIP});

  for await (const socket of iterator(server.readable.getReader())) {
    new HttpProxyServer({socket, replayUrl, replayTs, proxyIP, homePage, proxyPort, updateCallback}).handleResponse();
  }
}


const printer = (tag, ...args) => new TransformStream({
    transform(v, c) {
        console.log(...(tag ? [tag] : []), v);
        c.enqueue(v);
    }
});



async function monitorChannel(name, label) {
  broadcastStream(name).readable
  .pipeThrough(new EthernetParser)
  .pipeThrough(printer("ether " + label))
  .pipeThrough(new IPv4Parser)
  .pipeThrough(printer("ip " + label))
  .pipeTo(new WritableStream);
}

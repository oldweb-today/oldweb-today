// Copyright 2018 The Emulation-as-a-Service Authors.
// SPDX-License-Identifier: GPL-2.0-or-later

import "./streams-polyfills.js";

import {broadcastStream} from "./broadcast-stream.js";
import {NIC, parseMAC, NetworkStack} from "./webnetwork.js";

import {EthernetParser, IPv4Parser} from "./network-parser.js";
import TransformStream from "./transform-stream.js";

import RingBuffer from "sab-ring-buffer/ringbuffer.js";

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

  const PROXY_PAC = `
function FindProxyForURL(url, host)
{
    if (isInNet(host, "${proxyIP}") || shExpMatch(url, "http://${proxyIP}:${proxyPort}/*")) {
        return "DIRECT";
    }

    return "PROXY ${proxyIP}:${proxyPort}";
}
`;

  async function handleResponse(socket) {
    let req = null;

    try {
      req = new TextDecoder().decode((await socket.readable.getReader().read()).value);
    } catch (e) {
      console.log(e);
      sendResponse({
        content: "Server Error",
        status: 500,
        statusText: "Server Error",
        writer
      });
      return;
    }

    if (pingOnUpdate) {
      updateProxy.postMessage({done: true});
      pingOnUpdate = false;
    }

    const m = req.match(/GET\s([^\s]+)/);
    const writer = socket.writable.getWriter();

    let requestURL = m && m[1];

    if (requestURL === "/proxy.pac") {
      sendResponse({
        content: PROXY_PAC,
        contentType: "application/x-ns-proxy-autoconfig",
        writer
      });
      return;
    }

    if (requestURL === "/" || requestURL === homePage) {
      sendRedirect({
        redirect: replayUrl,
        writer
      });
      return;
    }

    if (!requestURL || !requestURL.startsWith("http://")) {
      sendResponse({
        content: "Invalid URL: " + requestURL,
        status: 400,
        statusText: "Bad Request",
        writer
      });
      return;
    }

    const targetUrl = m[1];

    const fetchUrl = "https://cors-anywhere.herokuapp.com/" + (replayTs ? `https://web.archive.org/web/${replayTs}id_/${targetUrl}` : targetUrl);

    const resp = await fetch(fetchUrl);

    if (resp.status !== 200 && !resp.headers.get("memento-datetime")) {
      let msg = "";
      let status = 400;

      switch (resp.status) {
        case 429:
          msg = "Too Many Requests. Please try again later";
          break;

        case 404:
          msg = "Page Not Found";
          status = resp.status;
          break;
      }

      sendResponse({
        content: `Sorry, an error has occured.\n(Status ${resp.status}) ${msg}`,
        status,
        statusText: "Bad Request",
        writer
      });
      return;
    }

    const content = await resp.arrayBuffer();
    const { status, statusText } = resp;
    const contentType = resp.headers.get("content-type");

    sendResponse({content, status, statusText, contentType, writer});
  }

  const encoder = new TextEncoder();

  function sendResponse({writer, content, status = 200, statusText = "OK", contentType = "text/plain"}) {
    const payload = typeof(content) === "string" ? encoder.encode(content) : new Uint8Array(content);

    writer.write(encoder.encode(`HTTP/1.0 ${status} ${statusText}\r\n\
Content-Type: ${contentType}\r\n\
Connection: close\r\n\
Proxy-Connection: close\r\n\
Content-Length: ${payload.byteLength}\r\n\
\r\n`));

    writer.write(payload);
    writer.close();
  }

  function sendRedirect({writer, redirect}) {
    writer.write(encoder.encode(`HTTP/1.0 301 Permanent Redirect\r\n\
Content-Type: text/plain\r\n\
Connection: close\r\n\
Proxy-Connection: close\r\n\
Content-Length: 0\r\n\
Location: ${redirect}\r\n\
\r\n`));

    writer.close();
  }


  for await (const s of iterator(server.readable.getReader())) {
    handleResponse(s);
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


//main();
//monitor();

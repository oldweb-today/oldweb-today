// Copyright 2018 The Emulation-as-a-Service Authors.
// SPDX-License-Identifier: GPL-2.0-or-later

//import(import.meta.url).then(v=>window.mod=v);

//import "https://rawgit.com/bellbind/web-streams-polyfill/master/dist/polyfill.min.js";
//import "https://rawgit.com/creatorrr/web-streams-polyfill/master/dist/polyfill.min.js";
import TransformStream from "./transform-stream.js";

import picotcp from "./picotcp.js";

export {picotcp};
export let globalStack;

const sleep = ms => new Promise(r => setTimeout(r, ms));

export const cidrToSubnet = (string) => {
    const [ip, prefixString] = string.split("/", 2);
    const prefixLength = parseInt(prefixString);
    const subnet = prefixLength && (-1 << (32 - prefixLength) >>> 0);
    return [ip, `${subnet >>> 24 & 0xff}.${subnet >>> 16 & 0xff}.${subnet >>> 8 & 0xff}.${subnet >>> 0 & 0xff}`];
};

export const parseMAC = (string) =>
    string.split(/:|-/).map(v => parseInt(v, 16));

export class Stream2 {
    constructor() {
        return new WritableStream(this);
    }
    write(controller, chunk) {
        console.log(chunk);
        return new Promise(() => {});
    }
}

export const pcapHeader = new Blob([new Uint32Array([
    0xa1b2c3d4,
    0x00040002,
    0x00000000,
    0x00000000,
    0x0000ffff,
    0x00000001,
])]);

class StreamRecorder {
    constructor(data = [pcapHeader]) {
        this.data = data;
    }
    transform(chunk, controller) {
        const buffer = chunk; // .buffer || chunk;
        const length = buffer.byteLength;
        const now = Date.now();
        const header = new Uint32Array([
            now / 1000,
            (now % 1000) * 1000,
            length,
            length,
        ]);
        this.data.push(new Blob([header, buffer]));
        controller.enqueue(chunk);
    }
}

export class RecordStream extends TransformStream {
    constructor(data) {
        const recorder = new StreamRecorder(data);
        super(recorder);
        this.recorder = recorder;
    }
    getDump() {
        return new Blob(this.recorder.data);
    }
}

export const blobToArrayBuffer = blob => new Promise((onload, onerror) =>
  Object.assign(new FileReader(), {onload, onerror}).readAsArrayBuffer(blob))
.then(v => v.target.result);

export function saveAs(blob, name) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    // Firefox needs `a` to be connected to document.
    document.head.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    // setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

export function randomMac() {
    const mac = self.crypto.getRandomValues(new Uint8Array(6));
    // Unicast, locally administered.
    mac[0] = mac[0] & ~0b00000001 | 0b00000010;
    return mac;
}

export class NetworkStack {
    constructor({mac, ipv4} = {}) {
        return (async () => {
            this._picotcp = await picotcp();
            this.start();
            return this;
        })();
    }

    start() {
        this._interval = setInterval(this.tick.bind(this), 10/*500*/);
    }
    stop() {
        clearInterval(this._interval);
        this._interval = null;
    }
    tick() {
        this._picotcp._pico_stack_tick();
    }
    async addInterface({mac = randomMac(), ip}) {
        const dev = await new NIC(this, mac);
        if (ip) dev.addIPv4(ip);
        return dev;
    }
}

let defaultNetwork;

const callAsync = async (emscriptenModule, executor, removeFunction = true, transform = (...args) => args) => {
    let resolve;
    const promise = new Promise(_resolve => resolve = _resolve);
    const ptr = emscriptenModule.addFunction((...args) => resolve(transform(...args)));
    executor(ptr);
    await promise;
    if (removeFunction) emscriptenModule.removeFunction(ptr);
    return promise;
}

export class NIC {
    constructor(stack, mac = randomMac()) {
        return (async () => {
            if (!stack) {
                if (!defaultNetwork) defaultNetwork = new NetworkStack();
                stack = await defaultNetwork;
            }
            this.stack = stack;
            this.dev = this.stack._picotcp.ccall("pico_js_create", "number", ["string", "array"], ["", mac]);
            this.stack._dev = this.dev;
            this.mac = mac;
            return this;
        })();
    }
    addIPv4(ip = "", netmask = "255.255.255.0") {
        this.stack._picotcp.ccall("js_add_ipv4", "number", ["number", "string", "string"], [this.dev, ip, netmask]);
    }
    async ping(dst, timeout = 1000) {
        return callAsync(this.stack._picotcp, ptr => this.stack._picotcp.ccall(
            "pico_icmp4_ping", "number",
            ["string", "number", "number", "number", "number", "number"],
            [dst, 1, 1, timeout, 64, ptr]));
    }
    async startDHCPClient() {
        const xidPtr = this.stack._picotcp._malloc(4);
        const [cli, code] = await callAsync(this.stack._picotcp, ptr => this.stack._picotcp.ccall(
            "pico_dhcp_initiate_negotiation", "number",
            ["number", "number", "number"],
            [this.dev, ptr, xidPtr]), false);
        const xid = this.stack._picotcp.HEAPU32[xidPtr / 4];
        this.stack._picotcp._js_accept_nameserver(cli);
        // Do not free xidPtr as picoTCP will use it again when
        // renewing the DHCP lease (not documented in picoTCP documentation).
        return [cli, code, xid];
    }
    startDHCPServer(ip) {
        const settingsPtr = this.stack._picotcp._malloc(9 * 4);
        const HEAPU32 = this.stack._picotcp.HEAPU32.subarray(settingsPtr / 4);
        HEAPU32[0] = 0
        HEAPU32[1] = 0;
        HEAPU32[2] = 0;
        HEAPU32[3] = 864000;  // 10 days DHCP lease
        HEAPU32[4] = this.dev;
        HEAPU32[5] = 0;
        HEAPU32[6] = new Uint32Array(Uint8Array.from(
            ip.split(/\./).map(v => parseInt(v, 10))).buffer)[0];
        HEAPU32[7] = 0;
        HEAPU32[8] = 0;
        const ret = this.stack._picotcp.ccall(
            "pico_dhcp_server_initiate", "number", ["number"], [settingsPtr]
        );
        this.stack._picotcp._free(settingsPtr);
        return ret;
    }
    addARPEntry(mac, ip) {
        const macPtr = this.stack._picotcp._malloc(6);
        this.stack._picotcp.HEAPU8.set(mac.slice(0, 6), macPtr);

        const ipPtr = this.stack._picotcp._malloc(4);
        this.stack._picotcp.HEAPU8.set(ip.slice(0, 4), ipPtr);

        const ret = this.stack._picotcp.ccall(
            "pico_arp_create_entry", "number", ["number", "number", "number"], [macPtr, ipPtr, this.dev]
        );

        this.stack._picotcp._free(macPtr);
        //this.stack._picotcp._free(ipPtr);

        return ret;
    }

    async getAddr(addr) {
        // TODO: This leaks `ptr` if `pico_dns_client_getaddr() != 0`.
        const {HEAPU8} = this.stack._picotcp;
        // HACK: IP addresses will never be longer than 255 bytes.
        const name = await callAsync(this.stack._picotcp, ptr =>
            this.stack._picotcp.ccall("pico_dns_client_getaddr", "number",
                ["string", "number", "number"], [addr, ptr, 0]), true,
                ipPtr => new TextDecoder().decode(
                    HEAPU8.subarray(ipPtr, ipPtr + 256)).split("\0")[0]);
        return name;
    }
    get readable() {
        return this.stack._picotcp.pointers[this.dev].readable;
    }
    get writable() {
        return this.stack._picotcp.pointers[this.dev].writable;
    }
    get TCPSocket() {
        const self = this;
        return class extends TCPSocket {
            get NIC() {return self;}
        }
    }
    get TCPServerSocket() {
        const self = this;
        return class extends TCPServerSocket {
            get NIC() {return self;}
        }
    }
}

/**
 * @see https://www.w3.org/TR/tcp-udp-sockets/#interface-tcpsocket
 */
class TCPSocket {
    constructor(remoteAddress, remotePort, options = {}) {
        const PICO_PROTO_IPV4 = 0, PICO_PROTO_IPV6 = 41;
        this._ptr = this.NIC.stack._picotcp.ccall("js_socket_open", "number", ["number", "number"], [PICO_PROTO_IPV4, new.target._proto]);
        ({readable: this.readable, writable: this.writable} = this.NIC.stack._picotcp.pointers[this._ptr]);
        console.log(this.NIC.stack._picotcp.ccall("js_socket_connect", "number", ["number", "string", "number"], [this._ptr, remoteAddress, remotePort]));
        console.log(this.NIC.stack._picotcp._js_pico_err());
    }

    static get _proto() {
        const PICO_PROTO_TCP = 6, PICO_PROTO_UDP = 17;
        return PICO_PROTO_TCP;
    }
}

/**
 * @see https://www.w3.org/TR/tcp-udp-sockets/#interface-tcpserversocket
 */
class TCPServerSocket {
    constructor({localAddress, localPort} = {}) {
        const PICO_PROTO_IPV4 = 0, PICO_PROTO_IPV6 = 41;
        this._ptr = this.NIC.stack._picotcp.ccall("js_socket_open", "number", ["number", "number"], [PICO_PROTO_IPV4, new.target._proto]);
        ({readable: this.readable, writable: this.writable} = this.NIC.stack._picotcp.pointers[this._ptr]);
        console.log(this.NIC.stack._picotcp.ccall("js_socket_bind", "number", ["number", "string", "number"], [this._ptr, localAddress, localPort]));
        console.log(this.NIC.stack._picotcp._js_pico_err());
    }

    static get _proto() {
        const PICO_PROTO_TCP = 6, PICO_PROTO_UDP = 17;
        return PICO_PROTO_TCP;
    }
}



/*
wait = ms=>{for(const end = performance.now() + ms; performance.now() < end;);}
setInterval(()=>{console.log(++x);wait(1100*a);console.log("done",x);}, 1000);x=0;a=1
*/

/** @param {Uint8Array} buffer */
self.SEND = buffer => {
    const length = buffer.length;
    // console.log("SENDING into VM -->", buffer, length);
    const blob = new Blob([new Uint8Array([length >> 8, length & 0xff]), buffer]);
    //ws.send(blob);
    console.log("SEND called");
    return length;
};

self.POLL = (n, dev, module) => {
    while (n--) {
        if (!self.NET_Q.length) break;
        const buf = self.NET_Q.shift();
        // TODO: When do we need to free this?
        const pointer = module._malloc(buf.length);
        module.writeArrayToMemory(buf, pointer);
        // console.log("<-- GETTING from VM", new Uint8Array(buf), buf.length, pointer);
        module.ccall("pico_stack_recv", "number", ["number", "number", "number"],
            [dev, pointer, buf.length]);
    }
    return n;
};

self.NET_Q = [];

export const messages = [];

export async function start() {
    let stack = picotcp();
    globalStack = stack;
    setInterval(() => stack._pico_stack_tick(), 500);
}

    // if (typeof TransformStream === "undefined") await import("https://rawgit.com/creatorrr/web-streams-polyfill/master/dist/polyfill.min.js");

    //const urls = Object.entries(data).filter(([k]) => k.startsWith("ws+ethernet+"));
    //const url = new URL(urls[0][1]);
    //const ws = new WebSocket(url);

/*    window.ws = ws;
    const stream = wrapWebSocket(ws)
        .pipeThrough(new Uint8ArrayStream())
        .pipeThrough(new VDEParser())
        // VDE does not send a CRC.
        .pipeThrough(new EthernetParser({crcLength: 0}))
        // .pipeThrough(new EthernetPrinter())
        .pipeThrough(new IPv4Parser())
        .pipeThrough(new UDPParser())
        ;
    const read = stream.getReader();
*/
//    for await (const chunk of read) {
//        window.Q.push(chunk);
//        try {stack._pico_stack_tick();} catch (e) {}
//        // console.log(chunk);
//    }

//}

new ReadableStream().getReader().__proto__[Symbol.asyncIterator] = function () {
    return {
        next: () => this.read(),
    };
}

export class StreamPrinter extends TransformStream {
    constructor(tag = "StreamPrinter") {
        super({
            transform(chunk, controller) {
                console.log(tag, chunk);
                controller.enqueue(chunk);
            }
        });
    }
}

export class EthernetPrinter extends TransformStream {
    constructor() {
        /**
         * @param {Uint8Array} frame
         * @param {*} controller
         */
        const transform = (frame, controller) => {
            controller.enqueue({
                ...frame,
                source: Array.from(frame.source).map(v => v.toString(16)),
                dest: Array.from(frame.dest).map(v => v.toString(16)),
                type: frame.type.toString(16),
                frame,
            });
        };
        super({transform});
    }
}

export function wrapWebSocket(ws) {
    return new ReadableStream({
        start(controller) {
            ws.addEventListener("message", ({data}) => controller.enqueue(data));
        }
    });
}

function getPromise() {
    let resolve, reject;
    const promise = new Promise((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });
    return {promise, resolve, reject};
};

export class Uint8ArrayStream extends TransformStream {
    constructor(websocketStream) {
        const reader = new FileReader();
        super({
            async transform(chunk, controller) {
                let ret;
                if (chunk instanceof Blob) {
                    reader.readAsArrayBuffer(chunk);
                    await ({resolve: reader.onload, reject: reader.onerror} = getPromise()).promise;
                    chunk = reader.result;
                }
                if (chunk.buffer) chunk = chunk.buffer;
                if (chunk instanceof ArrayBuffer) ret = new Uint8Array(chunk);
                else return;
                controller.enqueue(ret);
            }
        });
    }
}


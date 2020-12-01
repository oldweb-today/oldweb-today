// Copyright 2018 The Emulation-as-a-Service Authors.
// SPDX-License-Identifier: GPL-2.0-or-later

import TransformStream from "./transform-stream.js";

/**
 * @see <https://tools.ietf.org/html/rfc768>
 */
export class UDPParser extends TransformStream {
    /**
     * @param {payload: Uint8Array} lower
     * @param {*} controller
     */
    static transform(lower, controller) {
        const {payload} = lower;
        const ret = {
            source: payload[0] << 8 | payload[1],
            dest: payload[2] << 8 | payload[3],
            length: payload[4] << 8 | payload[5],
            checksum: payload[6] << 8 | payload[7],
        };
        Object.assign(ret, {
            payload: payload.subarray(8, ret.length),
            lower,
        });
        controller.enqueue(ret);
    }
    constructor() {super(new.target);}
}

/**
 * @see <https://tools.ietf.org/html/rfc791>
 */
export class IPv4Parser extends TransformStream {
    /**
     * @param {payload: Uint8Array} lower
     * @param {*} controller
     */
    static transform(lower, controller) {
        const {type, payload} = lower;
        if (type !== 0x800) return;
        const ret = {
            version: payload[0] >> 4,
            ihl: payload[0] & 0b1111,
            dscp: payload[1] >> 2,
            ecn: payload[1] & 0b11,
            length: payload[2] << 8 | payload[3],
            id: payload[4] << 8 | payload[5],
            flags: payload[6] >> 5,
            fragmentOffset: (payload[6] & 0b11111) << 8 | payload[7],
            ttl: payload[8],
            /** @see <https://www.iana.org/assignments/protocol-numbers/protocol-numbers.xhtml> */
            protocol: payload[9],
            headerChecksum: payload[10] << 8 | payload[11],
            source: payload.subarray(12, 12 + 4),
            dest: payload.subarray(16, 16 + 4),
        }
        const headerLength = 20;
        // TODO: options.
        Object.assign(ret, {
            payload: payload.subarray(headerLength, ret.length),
            lower,
        });
        controller.enqueue(ret);
    }
    constructor() {super(new.target);}
}

/**
 * @see <https://en.wikipedia.org/wiki/Ethernet_frame>
 */
export class EthernetParser extends TransformStream {
    constructor({crcLength = 0} = {}) {
        super({
            /**
             * @param {Uint8Array} frame
             * @param {*} controller
             */
            transform(frame, controller) {
                const dest = frame.subarray(0, 6);
                const source = frame.subarray(6, 12);
                /** @see <https://www.iana.org/assignments/ieee-802-numbers/ieee-802-numbers.xhtml> */
                const type = frame[12] << 8 | frame[13];
                const payload = frame.subarray(14, crcLength ? -crcLength : undefined);
                const crc = crcLength ? frame.subarray(-4) : null;
                controller.enqueue({source, dest, type, payload, crc, lower: frame});
            }
        });
    }
}

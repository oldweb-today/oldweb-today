//import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default [{
    input: 'jsnet.js',
    output: [
      {
        file: 'dist/jsnet.js',
        format: 'iife',
      },
    ],
    plugins: [nodeResolve()]
  },
  {
    input: 'jsnet-client.js',
    output: [
      {
        file: 'dist/jsnet-client.js',
        format: 'iife',
        name: 'JSNetClient'
      }
    ]
  }
]



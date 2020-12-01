//import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';
import serve from 'rollup-plugin-serve';
import livereload from 'rollup-plugin-livereload';

export default [{
    input: 'src/jsnet/jsnet.js',
    output: [
      {
        file: 'dist/jsnet.js',
        format: 'iife',
      },
    ],
    plugins: [
      nodeResolve(),
      copy({
        targets: [
          { src: 'src/jsnet/picotcp.*', dest: 'dist/' },
        ]
      })
    ]
  },
  {
    input: 'src/jsnet/jsnet-client.js',
    output: [
      {
        file: 'dist/jsnet-client.js',
        format: 'iife',
        name: 'JSNetClient'
      }
    ],
    plugins: [nodeResolve()]
  },
  {
    input: 'src/main.js',
    output: [
      {
        file: 'dist/main.js',
        format: 'iife',
      }
    ],
    plugins: [
      nodeResolve(),
      copy({
        targets: [
          { src: 'src/bas/BasiliskII.*', dest: 'dist/' },
          { src: 'src/bas/bas-worker.js', dest: 'dist/' },
          { src: 'src/v86/libv86.js', dest: 'dist/' }
        ]
      }),
      process.env.SERVE === "1" && 
      serve({
        contentBase: './',
        headers: {
         // 'Cross-Origin-Opener-Policy': 'same-origin',
         // 'Cross-Origin-Embedder-Policy': 'require-corp'
        },
      }),
      process.env.SERVE === "1" && 
      livereload({
        watch: "src/",
        verbose: true
      })
    ]
  }
]



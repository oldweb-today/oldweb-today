//import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';
import serve from 'rollup-plugin-serve';
import livereload from 'rollup-plugin-livereload';
import replace from '@rollup/plugin-replace';

const cdnPrefix = "https://dh-preserve.sfo2.digitaloceanspaces.com/owt";
const imagePrefix = cdnPrefix + "/images";

const imagePrefixGZ = "https://dh-preserve.sfo2.digitaloceanspaces.com/owt/images";


export default [{
    input: 'src/jsnet/jsnet.js',
    output: [
      {
        file: 'site/dist/jsnet.js',
        format: 'iife',
      },
    ],
    treeshake: false,
    plugins: [
      nodeResolve(),
      copy({
        targets: [
          { src: 'src/jsnet/picotcp.*', dest: 'site/dist/' },
        ]
      })
    ]
  },
  {
    input: 'src/jsnet/jsnet-client.js',
    output: [
      {
        file: 'site/dist/jsnet-client.js',
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
        file: 'site/dist/main.js',
        format: 'iife',
      }
    ],
    plugins: [
      nodeResolve(),
      copy({
        targets: [
          { src: 'src/bas/BasiliskII.*', dest: 'site/dist/' },
          { src: 'src/bas/bas-worker.js', dest: 'site/dist/' },
          { src: 'src/v86/libv86.js', dest: 'site/dist/' },
          { src: 'src/config.json', dest: 'site/assets/',
            transform: (contents) => {
              return contents.toString().replace(/\$IMGPATHGZ/g, imagePrefixGZ).replace(/\$IMGPATH/g, imagePrefix);
            }
          }
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
  },
  {
    input: 'src/worker/index.js',
    output: [{
      file: 'worker-site/index.js',
      format: 'iife',
    }],
    plugins: [
      replace({
        __CDN_PREFIX__: JSON.stringify(cdnPrefix),
      })
    ]
  },
]



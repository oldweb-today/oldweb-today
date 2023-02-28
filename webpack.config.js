/*eslint-env node */

const path = require("path");
const webpack = require("webpack");
//const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const package_json = require("./package.json");
const FileManagerPlugin = require('filemanager-webpack-plugin');

const ARCHIVE_PREFIX = "https://web.archive.org/web/";

const defaultOpts = {
  // base path for CDN
  cdnPrefix: "https://owt.sfo3.cdn.digitaloceanspaces.com",

  // base path for images
  imagePrefix: "https://owt.sfo3.cdn.digitaloceanspaces.com/images",

  // path to cors proxy
  corsPrefix: "https://wabac-cors-proxy.webrecorder.workers.dev/proxy/",
  //corsPrefix: "/proxy/",

  // set to ".gz" if gzipped state and images are being used, otherwise just use empty string
  useGZ: "",
};


// Copyright banner text
const BANNER_TEXT = `'[name].js is part of OldWebToday (https://oldweb.today) Copyright (C) 2020-${new Date().getFullYear()}, Webrecorder Software. Licensed under the Affero General Public License v3.'`;

const optimization = {
  minimize: true,
  minimizer: [
    new TerserPlugin({
      extractComments: false,
    }),
  ],
};

const jsnetConfig = () => {
  return {
    target: "webworker",
    mode: "production",
    entry: {
      "jsnet-client": "./src/jsnet/jsnet-client.js",
    },
    optimization,
    output: {
      path: path.join(__dirname, "site", "dist"),
      library: "JSNet",
      libraryTarget: "self"
    }
  }
};


const mainConfig = (opts) => {
  opts = {...defaultOpts, ...opts};

  const { cdnPrefix, imagePrefix, corsPrefix, useGZ } = opts;

  //const siteDist = path.resolve(__dirname, "site", "dist", "[name][ext]") ;
  const siteDist = "./site/dist/";

  return {
    target: "web",
    mode: "production",
    entry: {
      "jsnet": "./src/jsnet/jsnet.js",
      "main": "./src/main.js",
      "sw": "./src/sw/index.js",
    },
    resolve: {
      fallback: {
        "path": false,//require.resolve("path-browserify"),
        "fs": false
      },           
    },
    optimization,
    output: {
      path: path.join(__dirname, "site"),
      filename: (chunkData) => {
        if (chunkData.chunk.name === "sw") {
          return "sw.js";
        } else {
          return "dist/[name].js";
        }
      },
     },
    plugins: [
      new webpack.DefinePlugin({
        __CORS_PREFIX__: JSON.stringify(corsPrefix),
        __ARCHIVE_PREFIX__: JSON.stringify(ARCHIVE_PREFIX)
      }),
      new webpack.BannerPlugin(BANNER_TEXT),
      new webpack.NormalModuleReplacementPlugin(
        /^node:*/,
        (resource) => {
          switch (resource.request) {
          case "node:stream":
            resource.request = "stream-browserify";
            break;
          }
        },
      ),
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1,
      }),
      new webpack.ProvidePlugin({
        process: "process/browser",
      }),
 
      new CopyPlugin({
        patterns: [
          // Shared Config
          { 
            from: 'src/config.json', to: path.join(__dirname, 'site', 'assets', 'config.json'),
            transform: (contents) => contents.toString().replace(/\$IMAGE_PREFIX/g, imagePrefix).replace(/\$GZ/g, useGZ)
          },
        ],
      }),

      new FileManagerPlugin({
        events: {
          onEnd: {
            copy: [
              { source: 'src/jsnet/picotcp.*', destination: siteDist },

              // Basilisk
              { source: 'src/bas/BasiliskII.*', destination: siteDist },
              { source: 'src/bas/bas-worker.js', destination: siteDist },

              // V86
              { source: 'src/v86/libv86.js', destination: siteDist },
              { source: 'src/v86/v86.wasm', destination: siteDist },

              // Native SW
              //{ source: 'src/native/sw.js', destination: "./site/" },

              // Ruffle
              { source: 'src/native/ruffle/*', destination: "./site/ruffle/"},
            ]
          }
        }
      })
    ],

    module: {
      rules: [
        {
          test: /wombat.js|wombatWorkers.js|index.html$/i,
          use: ["raw-loader"],
        }
      ]
    },

    devServer: {
      compress: true,
      port: 10001,
      open: false,
      static:  path.join(__dirname, "site"),
      //publicPath: "/"
    },
  };
};
 
module.exports = [ mainConfig, jsnetConfig ];



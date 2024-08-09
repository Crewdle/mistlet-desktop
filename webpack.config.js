const path = require('path');

module.exports = () => {
  configs = {
    entry: './src/index.ts',
    target: 'electron-main',
    devtool: false,
    externals: {
      'keytar': 'commonjs keytar',
      'officeparser': 'commonjs officeparser',
      '@crewdle/mist-connector-webrtc-node': 'commonjs @crewdle/mist-connector-webrtc-node',
      '@crewdle/mist-connector-faiss': 'commonjs @crewdle/mist-connector-faiss',
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/
        },
        {
          test: /\.node$/,
          loader: 'node-loader',
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js', '.node'],
      modules: [path.resolve(__dirname, 'src'), 'node_modules'],
    },
    output: {
      filename: 'index.js',
      path: path.resolve(__dirname, 'src'),
    },
    optimization: {
      minimize: false,
    },
  };

  return configs;
}

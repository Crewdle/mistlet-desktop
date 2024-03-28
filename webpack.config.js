const path = require('path');

module.exports = () => {
  configs = {
    entry: './src/index.ts',
    target: 'electron-main',
    devtool: false,
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
      extensions: ['.ts', '.js'],
      modules: [path.resolve(__dirname, 'src'), 'node_modules'],
    },
    output: {
      filename: 'index.js',
      path: path.resolve(__dirname, 'src'),
    },
    optimization: {
      minimize: true,
    },
  };

  return configs;
}

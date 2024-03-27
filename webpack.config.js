const path = require('path');

module.exports = () => {
  configs = {
    entry: './src/index.ts',
    target: 'electron-main',
    devtool: 'inline-source-map',
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
      modules: [path.resolve(__dirname, 'src'), 'node_modules'],
    },
    output: {
      filename: 'index.js',
      path: path.resolve(__dirname, 'dist'),
    },
    optimization: {
      minimize: false,
    },
  };

  return configs;
}

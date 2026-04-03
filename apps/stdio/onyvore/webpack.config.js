const { composePlugins, withNx } = require('@nx/webpack');
const webpack = require('webpack');

module.exports = composePlugins(withNx(), (config) => {
  // Bundle everything — the server runs inside the extension package
  // which has no node_modules.
  config.externals = {};

  // Ignore optional NestJS microservices transport dependencies
  config.plugins = config.plugins || [];
  config.plugins.push(
    new webpack.IgnorePlugin({
      checkResource(resource) {
        const optionalDeps = [
          '@grpc/grpc-js',
          '@grpc/proto-loader',
          'kafkajs',
          'mqtt',
          'nats',
          'ioredis',
          'amqplib',
          'amqp-connection-manager',
          'bufferutil',
          'utf-8-validate',
          'class-validator',
          'class-transformer',
          '@nestjs/websockets',
          '@nestjs/websockets/socket-module',
          '@nestjs/microservices',
          '@nestjs/microservices/microservices-module',
          '@nestjs/platform-express',
        ];
        return optionalDeps.includes(resource);
      },
    })
  );

  config.ignoreWarnings = [
    /Failed to parse source map/,
    /Critical dependency/,
  ];

  return config;
});

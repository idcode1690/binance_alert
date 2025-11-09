const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  const target = 'http://localhost:3001';

  // Health and API endpoints
  app.use(
    ['/health', '/send-alert', '/set-symbol', '/send-test'],
    createProxyMiddleware({ target, changeOrigin: true })
  );

  // Server-Sent Events stream
  app.use(
    '/events',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      // ensure streaming isn't buffered
      selfHandleResponse: false,
      headers: {
        Connection: 'keep-alive'
      }
    })
  );
};

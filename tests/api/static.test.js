// The server also serves the front end; a broken static route breaks everything.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server.js');

test('static files', async t => {
  const server = await startServer();
  t.after(() => server.stop());

  for (const [route, type] of [['/', 'text/html'], ['/style.css', 'text/css'], ['/app.js', 'javascript']]) {
    await t.test(`${route} is served`, async () => {
      const response = await fetch(server.baseUrl + route);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), new RegExp(type));
      assert.ok((await response.text()).length > 0);
    });
  }
});
